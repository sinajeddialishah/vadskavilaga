import {PROTEINS, CARBS, normaliseRecipe} from './domain.js';

export function parseRecipeText(text) {
  if (text.length > 40000) throw new Error('Texten är för lång.');
  const draft = {title:'', minutes:0, protein:'', carb:'', ingredients:[], steps:[], tags:[], notes:'', is_public:false};
  let section = '';
  const units = ['g','kg','ml','dl','l','tsk','msk','krm','st','paket'];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-•]\s+/, '');
    if (!line) continue;
    if (/^Ingredienser\s*:$/i.test(line)) {section = 'ingredients'; continue;}
    if (/^Gör så här\s*:$/i.test(line)) {section = 'steps'; continue;}
    if (section === 'ingredients') {
      const match = line.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
      if (!match) {draft.ingredients.push({amount:null, unit:'', name:line}); continue;}
      const parts = match[2].split(/\s+/);
      const unit = units.includes(parts[0].toLowerCase()) ? parts.shift().toLowerCase() : '';
      draft.ingredients.push({amount:match[1], unit, name:parts.join(' ')});
      continue;
    }
    if (section === 'steps') {draft.steps.push(line.replace(/^\d+[.)]\s*/, '')); continue;}
    const meta = line.match(/^(Namn|Portioner|Tid|Protein|Kolhydrat)\s*:\s*(.*)$/i);
    if (!meta) throw new Error('Använd formatet Namn:, Tid:, Ingredienser: och Gör så här:.');
    const [, key, value] = meta;
    switch (key.toLowerCase()) {
      case 'namn': draft.title = value; break;
      case 'portioner': if (!/^4(?:\s+portioner)?$/i.test(value)) throw new Error('Ange receptet för 4 portioner innan du importerar.'); break;
      case 'tid':
        if (!/^\d+\s*(?:min|minuter)?$/i.test(value)) throw new Error('Ange tiden i minuter, till exempel Tid: 25 min.');
        draft.minutes = parseInt(value, 10); break;
      case 'protein':
      case 'kolhydrat': {
        const field = key.toLowerCase() === 'protein' ? 'protein' : 'carb';
        const options = field === 'protein' ? PROTEINS : CARBS;
        const option = options.find(item => item.toLocaleLowerCase('sv') === value.toLocaleLowerCase('sv'));
        if (value && !option) throw new Error('Okänd kategori: ' + value + '. Lämna raden tom om kategorin saknas.');
        draft[field] = option || ''; break;
      }
    }
  }
  return normaliseRecipe(draft);
}
