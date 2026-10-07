import {validateCatalog,type CatalogState,type CatalogStore} from './catalog.js';
export class CatalogConflictError extends Error {}
/** Contract implementation for tests/embedding; not a durable production database. */
export function createMemoryCatalog(initial:CatalogState):CatalogStore {
  let state=validateCatalog(initial);
  return {
    async read(){return validateCatalog(state);},
    async commit(expectedRevision,next){
      if(expectedRevision!==state.revision || next.revision!==expectedRevision) throw new CatalogConflictError('catalog revision changed');
      if(next.catalogId!==state.catalogId) throw new CatalogConflictError('catalog identity changed');
      const validated=validateCatalog({...next,revision:expectedRevision+1});
      state=validated;
      return validateCatalog(state);
    },
  };
}
