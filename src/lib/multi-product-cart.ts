/**
 * Product-line extraction for an explicit order naming multiple catalog items.
 * This is conservative: ambiguous names/options never become a silent sale.
 * No old assistant copy or OCR receipt is used as a product selection.
 */
export type MultiProductLine = { productId: string; optionId: string; quantity: number };
export type ProductForCart = {
  id:string; name:string; keywords?:string[];
  product_prices?: Array<{id:string;label:string;quantity:number;price:number;sort_order:number}>;
};
const norm=(value:string)=>value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
const ignored=new Set(["quiero","quisiera","llevo","dame","pedir","comprar","necesito","tambien","agrega",
  "sumale","otro","otra","unos","unas","para","por","favor","con","del","las","los","una","uno","el","la",
  "producto","articulo","unidad","unidades","caja","cajas","pack","combo","electrico","electrica","multifuncional"]);
const singular=(word:string)=>word.length>5 && word.endsWith("s") ? word.slice(0,-1) : word;
function closeToken(a:string,b:string):boolean{
  a=singular(a);b=singular(b);
  if(a===b)return true;
  if(a.length<5||b.length<5||Math.abs(a.length-b.length)>1)return false;
  let i=0,j=0,edits=0;
  while(i<a.length&&j<b.length){
    if(a[i]===b[j]){i++;j++;continue;}
    if(++edits>1)return false;
    if(a.length>b.length)i++;
    else if(b.length>a.length)j++;
    else{i++;j++;}
  }
  return edits+Number(i<a.length||j<b.length)<=1;
}
function productScore(segment:string,product:ProductForCart):number{
  const words=norm(segment).split(" ").filter(w=>w.length>=4&&!ignored.has(w));
  const terms=[product.name,...(product.keywords??[])].flatMap(v=>norm(v).split(" "))
    .filter(w=>w.length>=4&&!ignored.has(w));
  if(!words.length||!terms.length)return 0;
  const found=words.filter(w=>terms.some(t=>closeToken(w,t)));
  return found.length;
}
const wordsToNumber:Record<string,number>={un:1,uno:1,una:1,dos:2,tres:3,cuatro:4,cinco:5};
function requestedCount(text:string):number{
  const n=norm(text);
  const match=n.match(/\b(\d{1,2}|un|uno|una|dos|tres|cuatro|cinco)\s+(?:cajas?|packs?|combos?|unidades?|cepillos?|bases?)\b/)
    ?? n.match(/^\s*(\d{1,2}|un|uno|una|dos|tres|cuatro|cinco)\s+/);
  if(!match)return 1;
  const count=wordsToNumber[match[1]]??Number(match[1]);
  return Number.isSafeInteger(count)&&count>0&&count<=25?count:1;
}
function chooseOption(part:string,product:ProductForCart):{optionId:string;quantity:number}|null{
  const options=(product.product_prices??[]).filter(p=>Number(p.price)>0&&p.quantity>0);
  if(!options.length)return null;
  const requested=requestedCount(part);
  const exact=options.filter(o=>o.quantity===requested);
  // "2 unidades" with an explicitly priced bundle uses that bundle.
  const candidate=exact.length===1?exact[0]:requested===1?
    (options.length===1?options[0]:null):null;
  if(!candidate)return null;
  // Quantity is number of pieces except a priced box (one box may contain 2 bases).
  const packaging=/\b(?:caja|pack|combo)\b/.test(norm(candidate.label));
  if(requested>1 && candidate.quantity===requested && packaging && !/\b(?:cajas|packs|combos)\b/.test(norm(part)))
    return null;
  return {optionId:candidate.id,quantity:requested};
}
/** Only literal buying intentions joined with "y" or "+" can create a multi-product cart. */
export function resolveExplicitMultiProductCart(message:string,products:ProductForCart[]):MultiProductLine[]|null{
  const n=norm(message);
  if(!/\b(?:quiero|quisiera|llevo|llevare|comprar|pedir|agrega|agregame|sumale|tambien|necesito)\b/.test(n))
    return null;
  const pieces=message.split(/\s+y\s+|\s*\+\s*/i).map(s=>s.trim()).filter(Boolean);
  if(pieces.length<2||pieces.length>6)return null;
  const result:MultiProductLine[]=[];
  for(const part of pieces){
    const scores=products.map(p=>({p,score:productScore(part,p)})).filter(x=>x.score>0)
      .sort((a,b)=>b.score-a.score);
    if(!scores.length||scores.length>1&&scores[0].score===scores[1].score)return null;
    const p=scores[0].p;
    const selected=chooseOption(part,p);
    if(!selected)return null;
    if(result.some(x=>x.productId===p.id))return null;
    result.push({productId:p.id,optionId:selected.optionId,quantity:selected.quantity});
  }
  return result.length>=2?result:null;
}
export function resolveCartPricing(lines:MultiProductLine[],products:ProductForCart[]){
  if(lines.length<2||lines.length>10||new Set(lines.map(x=>x.productId)).size!==lines.length)return null;
  const resolved=lines.map(line=>{
    const p=products.find(p=>p.id===line.productId);
    const o=p?.product_prices?.find(o=>o.id===line.optionId);
    if(!p||!o||!Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>25||
       !Number.isFinite(Number(o.price))||Number(o.price)<=0)return null;
    const count=Number(line.quantity);
    const unitsPerPackage=Number(o.quantity);
    // The explicitly priced "2 unidades" option represents two articles.
    // "1 caja" is one transportable package, not two bases to charge twice.
    const price=Number(o.price);
    const unitPrice=unitsPerPackage===count && !/\b(?:caja|pack|combo)\b/.test(norm(o.label))
      ?price/count:price;
    const quantity=unitsPerPackage===count && !/\b(?:caja|pack|combo)\b/.test(norm(o.label))?count:count;
    return {productId:p.id,optionId:o.id,title:p.name,quantity,price:unitPrice,total:price,
      label:o.label};
  });
  if(resolved.some(x=>!x))return null;
  return resolved as NonNullable<typeof resolved[number]>[];
}
