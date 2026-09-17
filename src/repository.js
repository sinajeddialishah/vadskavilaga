import { createClient } from '@supabase/supabase-js';
import { SEED_RECIPE, DEFAULT_TAGS } from './domain.js';

const config = window.APP_CONFIG || {};
export const configured = Boolean(config.supabaseUrl && config.supabasePublishableKey);
const db = configured ? createClient(config.supabaseUrl, config.supabasePublishableKey, {
  auth: {flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}
}) : null;
let user = null;
let demo = false;
let demoRecipes = [];
let demoTags = [...DEFAULT_TAGS];
const photoUrls = new Map();
function check(error) { if (error) throw error; }
function dataOnly(recipe) {
  return Object.fromEntries(['title','protein','carb','minutes','tags','ingredients','steps','notes','favorite','is_public','image_path','starter_image','source_url','source_label'].map(key => [key, recipe[key] ?? (['image_path','source_url','source_label'].includes(key) ? null : recipe[key])]));
}
export const repository = {
  get isDemo() { return demo; },
  get user() { return user; },
  async session() {
    if (!db) return null;
    const {data, error} = await db.auth.getSession();
    check(error); user = data.session?.user || null;
    return user;
  },
  async login() {
    if (!db) throw new Error('Kontokopplingen är inte klar ännu. Använd förhandsvisningen tills dess.');
    const redirectTo = new URL('./', location.href).href;
    const {error} = await db.auth.signInWithOAuth({provider: 'google', options: {redirectTo, queryParams: {prompt: 'select_account'}}});
    check(error);
  },
  async logout() {
    if (!demo && db) { const {error} = await db.auth.signOut({scope: 'local'}); check(error); }
    for (const url of photoUrls.values()) URL.revokeObjectURL(url);
    photoUrls.clear(); demo = false; demoRecipes = []; user = null;
  },
  startDemo() {
    demo = true; user = null;
    demoRecipes = [{...structuredClone(SEED_RECIPE), is_public: true, is_mine: true}]; demoTags = [...DEFAULT_TAGS];
  },
  async load() {
    if (demo) {
      if (db) {
        const {data, error} = await db.rpc('list_public_preview_recipes');
        if (!error && data?.length) return {recipes: data.map(recipe => ({...recipe, notes: '', favorite: false, is_public: true, is_mine: false, revision: 1})), tags: [...demoTags]};
      }
      return {recipes: structuredClone(demoRecipes), tags: [...demoTags]};
    }
    if (!user) throw new Error('Logga in för att öppna dina recept.');
    const {error: initError} = await db.rpc('initialize_library'); check(initError);
    const [recipeResult, publicResult, settingsResult] = await Promise.all([
      db.from('recipes').select('*').order('created_at', {ascending: false}),
      db.rpc('list_public_recipes'),
      db.from('profiles').select('tags').eq('user_id', user.id).single()
    ]);
    check(recipeResult.error); check(publicResult.error); check(settingsResult.error);
    const own = recipeResult.data.map(recipe => ({...recipe, is_mine: true}));
    const ownIds = new Set(own.map(recipe => recipe.id));
    const published = (publicResult.data || []).filter(recipe => !ownIds.has(recipe.id)).map(recipe => ({...recipe, notes: '', favorite: false, is_public: true, is_mine: false, revision: 1}));
    return {recipes: [...own, ...published], tags: settingsResult.data.tags};
  },
  async save(recipe, isNew = false) {
    if (demo) {
      const saved = {...structuredClone(recipe), id: recipe.id || crypto.randomUUID(), revision: (recipe.revision || 0) + 1};
      const index = demoRecipes.findIndex(r => r.id === saved.id);
      if (index < 0) demoRecipes.unshift(saved); else demoRecipes[index] = saved;
      return structuredClone(saved);
    }
    let query;
    if (isNew) query = db.from('recipes').insert({...dataOnly(recipe), user_id: user.id});
    else query = db.from('recipes').update({...dataOnly(recipe), revision: recipe.revision + 1}).eq('id', recipe.id).eq('revision', recipe.revision);
    const {data, error} = await query.select().maybeSingle(); check(error);
    if (!data) throw new Error('Receptet har ändrats på en annan enhet. Din text finns kvar här. Kopiera den och uppdatera sidan innan du sparar igen.');
    return data;
  },
  async remove(recipe) {
    if (demo) { demoRecipes = demoRecipes.filter(r => r.id !== recipe.id); return; }
    const {data, error} = await db.from('recipes').delete().eq('id', recipe.id).eq('revision', recipe.revision).select('id');
    check(error);
    if (!data.length) throw new Error('Receptet har ändrats på en annan enhet. Uppdatera innan du tar bort det.');
    if (recipe.image_path) await this.removePhoto(recipe.image_path);
  },
  async addTag(tag) {
    if (demo) { demoTags = [...new Set([...demoTags, tag])]; return [...demoTags]; }
    const {data, error} = await db.rpc('add_recipe_tag', {new_tag: tag}); check(error); return data;
  },
  async uploadPhoto(blob, recipeId) {
    const path = `${demo ? 'demo' : user.id}/${recipeId}/${crypto.randomUUID()}.jpg`;
    if (demo) { photoUrls.set(path, URL.createObjectURL(blob)); return path; }
    const {error} = await db.storage.from('recipe-photos').upload(path, blob, {contentType: 'image/jpeg', upsert: false}); check(error);
    photoUrls.set(path, URL.createObjectURL(blob)); return path;
  },
  async photoUrl(path) {
    if (!path) return null;
    if (photoUrls.has(path)) return photoUrls.get(path);
    if (demo) return db.storage.from('recipe-photos').getPublicUrl(path).data.publicUrl;
    const {data, error} = await db.storage.from('recipe-photos').download(path); check(error);
    const url = URL.createObjectURL(data); photoUrls.set(path, url); return url;
  },
  async removePhoto(path) {
    if (!demo) {
      const {error} = await db.storage.from('recipe-photos').remove([path]);
      // A photo cleanup failure must never turn a committed recipe save into an apparent failure.
      if (error) { console.warn('Photo cleanup failed', error.message); return false; }
    }
    const url = photoUrls.get(path); if (url) URL.revokeObjectURL(url); photoUrls.delete(path); return true;
  }
};

export async function compressPhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Välj en bildfil.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Bilden är för stor. Välj en bild under 20 MB.');
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('Bilden kunde inte öppnas. Prova JPG, PNG eller WebP.'); }
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob || blob.size > 2 * 1024 * 1024) throw new Error('Bilden kunde inte minskas tillräckligt. Prova en mindre bild.');
  return blob;
}
