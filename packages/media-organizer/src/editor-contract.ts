import {z} from 'zod';
import {TimeRangeSchema,type TimeRange} from '@pea/core';
import {HostBindingSchema,type HostBinding} from './bindings.js';
import {CatalogTargetSchema,MetadataCandidateSchema,type CatalogTarget} from './metadata.js';
import type {OrganizationPlan} from './plans.js';
export const CapabilitySchema=z.enum(['hierarchy','tags','import','projectFields','reveal','rangeReveal','undo']);
export type Capability=z.infer<typeof CapabilitySchema>;
export const CapabilityReportSchema=z.object({editor:z.string().min(1),appVersion:z.string().min(1),os:z.string().min(1),adapterVersion:z.string().min(1),revision:z.string().min(1),features:z.record(CapabilitySchema,z.object({status:z.enum(['supported','unsupported','unverified']),reason:z.string()}).strict())}).strict();
export type CapabilityReport=z.infer<typeof CapabilityReportSchema>;
export const HostItemSnapshotSchema=z.object({hostItemId:z.string().min(1),itemRevision:z.string().min(1),kind:z.enum(['clip','bin','unsupported']),parentItemId:z.string().optional(),uri:z.string().optional(),sourceRange:TimeRangeSchema.optional(),metadata:z.array(MetadataCandidateSchema)}).strict();
export type HostItemSnapshot=z.infer<typeof HostItemSnapshotSchema>;
export const HostContextSchema=z.object({adapterId:z.string().min(1),hostProjectKey:z.string().min(1),hostRevision:z.string().min(1),catalogRevision:z.number().int().nonnegative(),capabilities:CapabilityReportSchema,bindings:z.array(HostBindingSchema),items:z.array(HostItemSnapshotSchema)}).strict();
export type HostContext=z.infer<typeof HostContextSchema>;
const OperationSchema=z.object({id:z.uuid(),target:CatalogTargetSchema,expectedItemRevision:z.string().optional(),dependsOn:z.array(z.string().min(1)),requiredCapabilities:z.array(CapabilitySchema),action:z.json()}).strict();
export const HostApplyPlanSchema=z.object({id:z.uuid(),organizationPlanId:z.uuid(),adapterSchemaVersion:z.string().min(1),expectedContext:HostContextSchema,operations:z.array(OperationSchema),compatibilityReport:z.array(z.object({severity:z.enum(['info','blocking']),code:z.string().min(1),targets:z.array(CatalogTargetSchema)}).strict())}).strict().superRefine((plan,ctx)=>{
  const ops=new Map(plan.operations.map(x=>[x.id,x]));
  if(ops.size!==plan.operations.length){ctx.addIssue({code:'custom',message:'duplicate operation ID'});return;}
  const visiting=new Set<string>(),done=new Set<string>();
  const visit=(id:string):boolean=>{
    if(visiting.has(id)||!ops.has(id))return false;if(done.has(id))return true;
    visiting.add(id);for(const dependency of ops.get(id)!.dependsOn)if(!visit(dependency))return false;
    visiting.delete(id);done.add(id);return true;
  };
  if(plan.operations.some(x=>!visit(x.id)))ctx.addIssue({code:'custom',message:'invalid operation dependency graph'});
});
export type JsonValue=z.infer<ReturnType<typeof z.json>>;
export type HostApplyPlan<TAction=JsonValue>=Omit<z.infer<typeof HostApplyPlanSchema>,'operations'>&{operations:(Omit<z.infer<typeof OperationSchema>,'action'>&{action:TAction})[]};
export const ApplyReceiptSchema=z.object({id:z.uuid(),hostPlanId:z.uuid(),status:z.enum(['exported','awaiting_import','verified_applied','partial','failed']),operations:z.array(z.object({id:z.uuid(),state:z.enum(['pending','exported','awaiting_import','verified_applied','skipped','blocked','failed']),reason:z.string().optional()}).strict()),createdBindings:z.array(HostBindingSchema)}).strict().superRefine((r,ctx)=>{
  if(new Set(r.operations.map(x=>x.id)).size!==r.operations.length)ctx.addIssue({code:'custom',message:'duplicate receipt operation'});
  if(r.status==='verified_applied'&&r.operations.some(x=>x.state!=='verified_applied'&&x.state!=='skipped'))ctx.addIssue({code:'custom',message:'receipt contains unverified work'});
});
export type ApplyReceipt=z.infer<typeof ApplyReceiptSchema>;
export interface EditorAdapter<TAction=JsonValue>{
  getCapabilities(context:HostContext):Promise<CapabilityReport>;
  readContext(selection:{kind:'selected'|'project'}):Promise<HostContext>;
  planApply(plan:OrganizationPlan,context:HostContext):Promise<HostApplyPlan<TAction>>;
  apply(plan:HostApplyPlan<TAction>):Promise<ApplyReceipt>;
  verify(receipt:ApplyReceipt):Promise<ApplyReceipt>;
  reveal(binding:HostBinding,range?:TimeRange):Promise<{status:'opened'|'unsupported'|'failed';reason?:string}>;
}
export function preflight<T>(input:HostApplyPlan<T>,currentInput:HostContext):{ok:boolean;reasons:string[]}{
  const plan=HostApplyPlanSchema.parse(input),current=HostContextSchema.parse(currentInput),expected=plan.expectedContext,reasons:string[]=[];
  for(const field of ['adapterId','hostProjectKey','hostRevision','catalogRevision'] as const)if(expected[field]!==current[field])reasons.push(`${field} changed`);
  for(const field of ['editor','appVersion','os','adapterVersion','revision'] as const)if(expected.capabilities[field]!==current.capabilities[field])reasons.push(`capability ${field} changed`);
  if(plan.compatibilityReport.some(x=>x.severity==='blocking'))reasons.push('blocking compatibility loss');
  for(const op of plan.operations){
    for(const capability of op.requiredCapabilities)if(expected.capabilities.features[capability].status!=='supported'||current.capabilities.features[capability].status!=='supported')reasons.push(`unsupported capability: ${capability}`);
    if(op.target.kind!=='clip'){if(op.expectedItemRevision)reasons.push('item revision requires a clip binding');continue;}
    const binding=expected.bindings.find(x=>x.clipId===op.target.id&&x.adapterId===expected.adapterId&&x.hostProjectKey===expected.hostProjectKey);
    if(!binding){if(op.expectedItemRevision)reasons.push('expected binding is missing');continue;}
    const live=current.bindings.find(x=>x.bindingId===binding.bindingId&&x.clipId===binding.clipId&&x.adapterId===current.adapterId&&x.hostProjectKey===current.hostProjectKey&&x.hostItemId===binding.hostItemId);
    const item=live&&current.items.find(x=>x.hostItemId===live.hostItemId);
    if(!live||!item||live.hostRevision!==binding.hostRevision||item.itemRevision!==(op.expectedItemRevision??binding.hostRevision))reasons.push('bound item changed');
  }
  return {ok:reasons.length===0,reasons};
}
export type ObservedState='at_target'|'at_expected'|'changed'|'unknown';
function checkReceipt(plan:HostApplyPlan,raw:ApplyReceipt):ApplyReceipt{
  const receipt=ApplyReceiptSchema.parse(raw);
  if(receipt.hostPlanId!==plan.id)throw new Error('receipt is for another plan');
  if(receipt.operations.some(x=>!plan.operations.some(o=>o.id===x.id)))throw new Error('receipt contains unknown operation');
  return receipt;
}
export function retryableOperationIds<T>(input:HostApplyPlan<T>,raw:ApplyReceipt|undefined,observed:Record<string,ObservedState>):string[]{
  const plan=HostApplyPlanSchema.parse(input),receipt=raw&&checkReceipt(plan,raw);
  return plan.operations.filter(op=>{
    const result=receipt?.operations.find(x=>x.id===op.id);
    return observed[op.id]==='at_expected'&&(!result||result.state==='failed'||result.state==='pending')
      &&op.dependsOn.every(id=>observed[id]==='at_target')
      &&op.requiredCapabilities.every(c=>plan.expectedContext.capabilities.features[c].status==='supported')
      &&!plan.compatibilityReport.some(r=>r.severity==='blocking'&&(!r.targets.length||r.targets.some(t=>t.kind===op.target.kind&&t.id===op.target.id)));
  }).map(x=>x.id);
}
/** Call only with observations obtained by the adapter's host re-read. */
export function reconcileReceipt<T>(input:HostApplyPlan<T>,raw:ApplyReceipt,observed:Record<string,ObservedState>):ApplyReceipt{
  const plan=HostApplyPlanSchema.parse(input),receipt=checkReceipt(plan,raw);
  const operations:ApplyReceipt['operations']=plan.operations.map(op=>{
    const prior=receipt.operations.find(x=>x.id===op.id);
    if(observed[op.id]==='at_target')return {id:op.id,state:'verified_applied'};
    if(observed[op.id]==='changed'||observed[op.id]==='at_expected')return {id:op.id,state:'failed',reason:'host does not match reviewed target'};
    if(prior?.state==='exported'||prior?.state==='awaiting_import')return prior;
    return {id:op.id,state:'blocked',reason:'host result is unknown'};
  });
  const status:ApplyReceipt['status']=operations.every(x=>x.state==='verified_applied')?'verified_applied':operations.every(x=>x.state==='exported')?'exported':operations.every(x=>x.state==='awaiting_import')?'awaiting_import':operations.every(x=>x.state==='failed'||x.state==='blocked')?'failed':'partial';
  return ApplyReceiptSchema.parse({...receipt,operations,status});
}
