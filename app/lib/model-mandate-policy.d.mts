export interface LocalModelPolicy {models:{id:string;kind:string}[];totalAmount:string;perCallAmount:string;maxCalls:number;expiresAt:number}
export interface LocalModelReservation {id:string;termsKey:string;amount:string;cumulativeAmount:string}
export interface LocalModelState {spentAmount:string;usedCalls:number;stopped:boolean;pending:LocalModelReservation|null}
export function modelRecoveryAction(policy:LocalModelPolicy,state:LocalModelState,job:{state:string;terms:{expiresAt:number}},hasSubmission:boolean,allowReplay:boolean,now?:number):'status'|'replay'|'cancel';
export function reserveLocalModelCall(policy:LocalModelPolicy,state:LocalModelState,job:{id:string;terms:{modelId:string;kind:string;amount:string;expiresAt:number}},now?:number):LocalModelReservation;
export function serializeLocalModelOperation<T>(id:string,action:()=>Promise<T>):Promise<T>;
export function processPhoneModelQueue<T>(requests:readonly T[],authorize:(request:T)=>Promise<unknown>,isCurrent:()=>boolean):Promise<string|null>;
