import MiniSearch from 'minisearch';
import {validateCatalog,type CatalogState} from './catalog.js';
import {type CatalogTarget,targetKey,effectiveMetadata,annotationsForTarget,assetForTarget} from './metadata.js';
import {filenameFromUri} from './rules.js';
import {SearchQuerySchema,type SearchQuery} from './search-query.js';
export * from './search-query.js';
export type SearchHit={target:CatalogTarget;mediaAssetId:string;score:number};
export interface SearchIndex {rebuild(state:CatalogState):Promise<void>;update(state:CatalogState,targets:CatalogTarget[]):void;search(query:SearchQuery):SearchHit[]}
const normalize=(text:string)=>text.normalize('NFC').toLowerCase();
const tokenize=(text:string)=>normalize(text).split(/[\s\p{P}\p{Z}]+/u).filter(Boolean);
interface SearchDocument {id:string;target:CatalogTarget;mediaAssetId:string;filename:string;tagsText:string;notes:string;metadata:string;captureDate?:string;deviceId?:string;mediaKind?:string;tags:string[];favorite:boolean;availability:string}
function documents(input:CatalogState):Map<string,SearchDocument>{
  const state=validateCatalog(input),docs=new Map<string,SearchDocument>();
  for(const asset of state.assets){
    const clips=state.clips.filter(c=>c.mediaAssetId===asset.asset.id);
    const targets:CatalogTarget[]=clips.length?clips.map(c=>({kind:'clip',id:c.id})):[{kind:'asset',id:asset.asset.id}];
    for(const target of targets){
      const annotations=annotationsForTarget(target,state);
      const tags=annotations.filter(a=>a.kind==='tag').map(a=>normalize(String(a.value)));
      const field=(name:'captureDate'|'deviceId'|'scene'|'take'|'mediaKind')=>effectiveMetadata(target,state,name).value;
      const captureDate=field('captureDate'),deviceId=field('deviceId'),mediaKind=field('mediaKind');
      const favorites=annotations.filter(a=>a.kind==='favorite');
      const favorite=(favorites.find(a=>targetKey(a.target)===targetKey(target))??favorites[0])?.value===true;
      docs.set(targetKey(target),{id:targetKey(target),target,mediaAssetId:assetForTarget(target,state).asset.id,
        filename:filenameFromUri(asset.asset.uri),tagsText:tags.join(' '),notes:annotations.filter(a=>a.kind==='note').map(a=>a.value).join(' '),
        metadata:[captureDate,deviceId,mediaKind,field('scene'),field('take')].filter(Boolean).join(' '),captureDate,deviceId,mediaKind,tags,favorite,availability:asset.availability});
    }
  }
  return docs;
}
const makeIndex=()=>new MiniSearch<SearchDocument>({fields:['filename','tagsText','notes','metadata'],idField:'id',tokenize,processTerm:normalize});
export function createSearchIndex():SearchIndex{
  let index=makeIndex(),docs=new Map<string,SearchDocument>(),generation=0;
  return {
    async rebuild(state){
      const mine=++generation,nextDocs=documents(state),next=makeIndex();
      await next.addAllAsync([...nextDocs.values()],{chunkSize:10});
      if(mine===generation){index=next;docs=nextDocs;}
    },
    update(state,_targets){
      const nextDocs=documents(state);generation++;
      // Reconcile the supplied complete snapshot, including removed clips/assets.
      for(const key of docs.keys())if(!nextDocs.has(key))index.discard(key);
      for(const [key,doc] of nextDocs){
        const old=docs.get(key);
        if(!old)index.add(doc);else if(JSON.stringify(old)!==JSON.stringify(doc))index.replace(doc);
      }
      docs=nextDocs;
    },
    search(input){
      const query=SearchQuerySchema.parse(input),f=query.filters;
      const results=tokenize(query.text).length?index.search(query.text,{combineWith:'AND',prefix:(_t,i,terms)=>i===terms.length-1,fuzzy:false}):[...docs.keys()].map(id=>({id,score:0}));
      return results.flatMap(result=>{
        const d=docs.get(String(result.id));if(!d)return [];
        if(f.captureDate!==undefined&&f.captureDate!==d.captureDate)return [];
        if(f.deviceId!==undefined&&normalize(f.deviceId)!==normalize(d.deviceId??''))return [];
        if(f.mediaKind!==undefined&&f.mediaKind!==d.mediaKind)return [];
        if(f.favorite!==undefined&&f.favorite!==d.favorite)return [];
        if(f.availability!==undefined&&f.availability!==d.availability)return [];
        if(f.tags?.some(t=>!d.tags.includes(normalize(t))))return [];
        return [{target:{...d.target},mediaAssetId:d.mediaAssetId,score:result.score}];
      }).sort((a,b)=>b.score-a.score||(targetKey(a.target)<targetKey(b.target)?-1:targetKey(a.target)>targetKey(b.target)?1:0));
    },
  };
}
