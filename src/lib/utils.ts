import { endpointIdToNetwork } from '@layerzerolabs/lz-definitions'
import { Options } from '@layerzerolabs/lz-v2-utilities'
import type { MetaMaskProvider, NetworkConfig } from './types'

// Extend Window interface to include ethereum
declare global {
    interface Window {
        ethereum?: MetaMaskProvider
    }
}

export const deploymentMetadataUrl = 'https://metadata.layerzero-api.com/v1/metadata/deployments'

/**
 * Get LayerZero scan link for transaction tracking
 */
export function getLayerZeroScanLink(txHash: string, isTestnet = false): string {
    const baseUrl = isTestnet ? 'https://testnet.layerzeroscan.com' : 'https://layerzeroscan.com'
    return `${baseUrl}/tx/${txHash}`
}

/**
 * Get block explorer link for a transaction
 */
export async function getBlockExplorerLink(srcEid: number, txHash: string): Promise<string | undefined> {
    const network = endpointIdToNetwork(srcEid)
    const res = await fetch(deploymentMetadataUrl)
    if (!res.ok) return
    const all = (await res.json()) as Record<string, { blockExplorers?: Array<{ url: string }> }>
    const meta = all[network]
    const explorer = meta?.blockExplorers?.[0]?.url
    if (explorer) {
        return `${explorer.replace(/\/+$/, '')}/tx/${txHash}`
    }
    return
}

/**
 * Format bigint for display
 */
function formatBigIntForDisplay(n: bigint) {
    return n.toLocaleString().replace(/,/g, '_')
}

/**
 * Decode LayerZero receive options
 */
export function decodeLzReceiveOptions(hex: string): string {
    try {
        if (!hex || hex === '0x') return 'No options set'
        const options = Options.fromOptions(hex)
        const lzReceiveOpt = options.decodeExecutorLzReceiveOption()
        return lzReceiveOpt
            ? `gas: ${formatBigIntForDisplay(lzReceiveOpt.gas)} , value: ${formatBigIntForDisplay(lzReceiveOpt.value)} wei`
            : 'No executor options'
    } catch {
        return `Invalid options (${hex.slice(0, 12)}...)`
    }
}

/**
 * Check if MetaMask is installed
 */
export function isMetaMaskInstalled(): boolean {
    return typeof window !== 'undefined' && typeof window.ethereum !== 'undefined' && window.ethereum.isMetaMask === true
}

/**
 * Get MetaMask provider
 */
export function getMetaMaskProvider(): MetaMaskProvider {
    if (typeof window !== 'undefined' && window.ethereum) {
        return window.ethereum
    }
    throw new Error('MetaMask not found. Please install MetaMask extension.')
}

/**
 * Request MetaMask account access
 */
export async function requestMetaMaskAccounts(): Promise<string[]> {
    const provider = getMetaMaskProvider()
    try {
        const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[]
        return accounts
    } catch {
        throw new Error('User rejected account access')
    }
}

/**
 * Get current MetaMask account
 */
export async function getCurrentAccount(): Promise<string | null> {
    const provider = getMetaMaskProvider()
    try {
        const accounts = await provider.request({ method: 'eth_accounts' }) as string[]
        return accounts[0] || null
    } catch {
        return null
    }
}

/**
 * Get current chain ID
 */
export async function getCurrentChainId(): Promise<string> {
    const provider = getMetaMaskProvider()
    try {
        const chainId = await provider.request({ method: 'eth_chainId' }) as string
        return chainId
    } catch {
        throw new Error('Failed to get chain ID')
    }
}

/**
 * Switch network in MetaMask
 */
export async function switchNetwork(chainId: string): Promise<void> {
    const provider = getMetaMaskProvider()
    try {
        await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId }],
        })
    } catch (error: unknown) {
        if (typeof error === 'object' && error && 'code' in error && error.code === 4902) {
            throw new Error(`Network with chainId ${chainId} not found. Please add it to MetaMask.`)
        }
        throw new Error('Failed to switch network')
    }
}

/**
 * Add network to MetaMask
 */
export async function addNetwork(networkConfig: NetworkConfig): Promise<void> {
    const provider = getMetaMaskProvider()
    try {
        await provider.request({
            method: 'wallet_addEthereumChain',
            params: [networkConfig],
        })
    } catch {
        throw new Error('Failed to add network to MetaMask')
    }
} 