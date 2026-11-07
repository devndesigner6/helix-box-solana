import {PNG} from 'pngjs';
import {MPEGDecoder} from 'mpg123-decoder';

export function validatePNG(bytes:Buffer):void {
  try {
    if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error();
    const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
    // Check dimensions before the decoder can allocate a pixel buffer.
    if(!width||!height||width>4096||height>4096||width*height>8*1024*1024)throw Error();
    const decoded=PNG.sync.read(bytes,{checkCRC:true});
    if(!decoded.data.length||decoded.width!==width||decoded.height!==height)throw Error();
  }catch{throw new Error('Model returned invalid or oversized image output');}
}
export async function validateMP3(bytes:Buffer):Promise<void> {
  const decoder=new MPEGDecoder();
  try {
    await decoder.ready;
    let seconds=0;
    // Decode incrementally and discard PCM, rather than expanding an entire audio file.
    for(let offset=0;offset<bytes.length;offset+=4096) {
      const audio=decoder.decode(bytes.subarray(offset,offset+4096));
      if(audio.errors.length)throw Error();
      if(audio.samplesDecoded){
        if(audio.sampleRate<8000||audio.sampleRate>192000||audio.channelData.length<1||audio.channelData.length>2)throw Error();
        seconds+=audio.samplesDecoded/audio.sampleRate;
        if(seconds>300)throw Error();
      }
    }
    if(seconds<=0)throw Error();
  }catch{throw new Error('Model returned invalid or oversized audio output');}
  finally{decoder.free();}
}
