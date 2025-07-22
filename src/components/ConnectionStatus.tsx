import type { UseOFTClientReturn } from '../hooks/useOFTClient'

interface ConnectionStatusProps {
    oftClient: UseOFTClientReturn
}

export function ConnectionStatus({ oftClient }: ConnectionStatusProps) {
    const { isConnected, loading, error, address, chainId, connect, disconnect } = oftClient

    const getNetworkName = (chainId: number | null) => {
        if (!chainId) return 'Unknown'
        
        const networks: Record<number, string> = {
            1: 'Ethereum Mainnet',
            56: 'BSC Mainnet',
            137: 'Polygon Mainnet',
            43114: 'Avalanche Mainnet',
            42161: 'Arbitrum One',
            10: 'Optimism',
            250: 'Fantom',
            11155111: 'Ethereum Sepolia',
            97: 'BSC Testnet'
        }
        
        return networks[chainId] || `Chain ID ${chainId}`
    }

    const formatAddress = (address: string | null) => {
        if (!address) return 'Not connected'
        return `${address.slice(0, 6)}...${address.slice(-4)}`
    }

    if (loading) {
        return (
            <div className="connection-status loading">
                <div className="spinner"></div>
                <span>Connecting to MetaMask...</span>
            </div>
        )
    }

    if (error) {
        return (
            <div className="connection-status error">
                <div className="error-message">
                    <strong>Connection Error:</strong> {error}
                </div>
                <button onClick={connect} className="btn btn-primary">
                    Try Again
                </button>
            </div>
        )
    }

    if (!isConnected) {
        return (
            <div className="connection-status disconnected">
                <div className="status-info">
                    <strong>Not Connected</strong>
                    <p>Connect your MetaMask wallet to start transferring tokens</p>
                </div>
                <button onClick={connect} className="btn btn-primary">
                    Connect MetaMask
                </button>
            </div>
        )
    }

    return (
        <div className="connection-status connected">
            <div className="status-info">
                <div className="status-item">
                    <strong>Connected:</strong> {formatAddress(address)}
                </div>
                <div className="status-item">
                    <strong>Network:</strong> {getNetworkName(chainId)}
                </div>
            </div>
            <button onClick={disconnect} className="btn btn-secondary">
                Disconnect
            </button>
        </div>
    )
} 