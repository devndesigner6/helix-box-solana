import type {Database} from 'bun:sqlite';
import {posix} from 'node:path';

// The caller supplies canonical paths; filename configuration alone is not durability.
export function persistentModelStore(file:string,mount:string,mountInfo:string):boolean {
  if(!posix.isAbsolute(file)||!posix.isAbsolute(mount)||mount==='/')return false;
  file=posix.normalize(file);mount=posix.normalize(mount).replace(/\/$/,'');
  if(!file.startsWith(mount+'/'))return false;
  return mountInfo.split('\n').some(line=>{
    const [left,right]=line.split(' - ');if(!right)return false;
    const point=left.split(' ')[4]?.replace(/\\([0-7]{3})/g,(_,octal)=>String.fromCharCode(parseInt(octal,8)));
    return point===mount&&['ext4','xfs','btrfs','zfs'].includes(right.split(' ')[0]);
  });
}
export function assertFinancialResetSafe(db:Database):void {
  for(const table of ['model_purchases','solana_payment_receipts','model_mandates','model_mandate_reservations','model_channels']) {
    if(!db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
    if(db.query(`SELECT 1 FROM ${table} LIMIT 1`).get())throw new Error('Refusing --new: this database contains a financial ledger. Preserve its receipts and backups.');
  }
}
