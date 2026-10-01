const h=require('fs').readFileSync(process.argv[2],'utf8');
const t=h.replace(/<script[\s\S]*?<\/script>/g,' ').replace(/<style[\s\S]*?<\/style>/g,' ').replace(/<[^>]+>/g,' ').replace(/&[a-z#0-9]+;/g,' ').replace(/\s+/g,' ');
const i=t.indexOf('On this page'); console.log(t.slice(i>0?i:0, (i>0?i:0)+Number(process.argv[3]||6000)));
