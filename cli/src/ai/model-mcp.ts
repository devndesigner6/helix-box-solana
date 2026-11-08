import {createModelToolClient,MODEL_TOOL_DEFINITIONS} from './model-tools.js';

const client=createModelToolClient(()=>process.env.HELIXBOX_MODEL_PASSWORD?{managerUrl:process.env.HELIXBOX_MODEL_MANAGER||'https://helixbox-manager.onrender.com',password:process.env.HELIXBOX_MODEL_PASSWORD}:null);
let pending='',active=0;
process.stdin.setEncoding('utf8');
const send=(value:unknown)=>process.stdout.write(JSON.stringify(value)+'\n');
async function handle(raw:string) {
  let message:any;try{message=JSON.parse(raw);}catch{send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}});return;}
  if(!message||message.jsonrpc!=='2.0'||message.id===undefined)return;
  if(++active>4){active--;send({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:'Model tool is busy'}});return;}
  try {
    let result:unknown;
    if(message.method==='initialize')result={protocolVersion:['2025-11-25','2025-06-18','2024-11-05'].includes(message.params?.protocolVersion)?message.params.protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'helixbox-model-tools',version:'1.0.0'}};
    else if(message.method==='ping')result={};
    else if(message.method==='tools/list')result={tools:MODEL_TOOL_DEFINITIONS};
    else if(message.method==='tools/call') {
      try{result={content:[{type:'text',text:JSON.stringify(await client.call(message.params?.name,message.params?.arguments??{}))}]};}
      catch(error){result={isError:true,content:[{type:'text',text:error instanceof Error?error.message:'Model tool failed'}]};}
    }else{send({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}});return;}
    send({jsonrpc:'2.0',id:message.id,result});
  }finally{active--;}
}
process.stdin.on('data',(chunk:string)=>{
  pending+=chunk;let newline;
  while((newline=pending.indexOf('\n'))>=0){const line=pending.slice(0,newline);pending=pending.slice(newline+1);if(Buffer.byteLength(line)>32768){process.exitCode=1;process.stdin.destroy();return;}if(line.trim())void handle(line);}
  if(Buffer.byteLength(pending)>32768){process.exitCode=1;process.stdin.destroy();}
});
