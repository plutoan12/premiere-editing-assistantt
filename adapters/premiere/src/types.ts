export interface PremiereMediaRef {clipId:string;mediaAssetId?:string;projectItemId:string}
export interface PremiereProjectSnapshot {projectId:string;projectVersion:string;sequenceNames:string[];media:PremiereMediaRef[]}
export interface PremiereSyncOperation {kind:"place";clipId:string;projectItemId:string;startSeconds:number;trackIndex:number;quantizationErrorSeconds:number}
export interface PremiereSyncDryRun {sequenceName:string;projectId:string;projectVersion:string;operations:PremiereSyncOperation[];warnings:string[];errors:string[]}
export interface PremiereSyncOptions {sequenceName:string;frameRate:{numerator:number;denominator:number}}
