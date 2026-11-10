import { explorerBase } from "./config.js";

export function addressUrl(chainId: number, address: string): string {
  return `${explorerBase(chainId)}/address/${address}`;
}

export function txUrl(chainId: number, txHash: string): string {
  return `${explorerBase(chainId)}/tx/${txHash}`;
}
