// Main library exports
export { OFTClient } from './oft-client'
export * from './types'
export * from './utils'

// Re-export commonly used utilities
export { 
    isMetaMaskInstalled, 
    getMetaMaskProvider, 
    requestMetaMaskAccounts, 
    getCurrentAccount,
    getCurrentChainId,
    switchNetwork,
    addNetwork,
    getLayerZeroScanLink,
    getBlockExplorerLink
} from './utils' 