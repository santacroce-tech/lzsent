import type { BigNumberish } from 'ethers'

export interface SendResult {
    txHash: string
    scanLink: string
}

export interface EvmSendArgs {
    srcEid: number
    dstEid: number
    amount: string
    to: string
    oftAddress: string
    minAmount?: string
    extraLzReceiveOptions?: string[]
    extraLzComposeOptions?: string[]
    extraNativeDropOptions?: string[]
    composeMsg?: string
}

export interface TokenInfo {
    name: string
    symbol: string
    decimals: number
    address: string
}

export interface QuoteResult {
    nativeFee: BigNumberish
    lzTokenFee: BigNumberish
    tokenInfo?: TokenInfo
}

export interface OFTConfig {
    address: string
    underlyingToken: string
    decimals: number
    approvalRequired: boolean
}

export interface SendParams {
    dstEid: number
    to: string
    amountLD: string
    minAmountLD: string
    extraOptions: string
    composeMsg: string
    oftCmd: string
}

export interface MetaMaskProvider {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
    on: (eventName: string, handler: (params: unknown) => void) => void
    removeListener: (eventName: string, handler: (params: unknown) => void) => void
    isMetaMask?: boolean
}

export interface NetworkConfig {
    chainId: string
    chainName: string
    nativeCurrency: {
        name: string
        symbol: string
        decimals: number
    }
    rpcUrls: string[]
    blockExplorerUrls: string[]
}

export interface LayerZeroConfig {
    contracts: Array<{
        contract: {
            eid: number
            address: string
        }
    }>
} 