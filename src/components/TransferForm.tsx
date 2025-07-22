import { useState } from 'react'
import { OFTClient } from '../lib'
import type { QuoteResult, SendResult } from '../lib'
import { ethers } from 'ethers'

interface TransferFormProps {
    client: OFTClient
    onTransfer: (result: SendResult) => void
    onError: (error: string) => void
}

interface TransferData {
    srcEid: number
    dstEid: number
    amount: string
    to: string
    oftAddress: string
    minAmount: string
}

interface TokenInfo {
    name: string
    symbol: string
    decimals: number
    address: string
}



export function TransferForm({ client, onTransfer, onError }: TransferFormProps) {
    const [transferData, setTransferData] = useState<TransferData>({
        srcEid: 30101,
        dstEid: 30102,
        amount: '3.0',
        to: '0x02F9d861446fFCe632e7553f3eeBf66e3c85667d',
        oftAddress: '',
        minAmount: ''
    })

    const [quote, setQuote] = useState<QuoteResult | null>(null)
    const [loading, setLoading] = useState(false)
    const [quoteLoading, setQuoteLoading] = useState(false)
    const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null)
    


    const handleInputChange = (field: keyof TransferData, value: string | number) => {
        setTransferData(prev => ({
            ...prev,
            [field]: value
        }))
        
        // If OFT address changed, try to get token info immediately
        if (field === 'oftAddress' && typeof value === 'string' && value.startsWith('0x') && value.length === 42) {
            getTokenInfo(value)
        }
    }

    const getTokenInfo = async (oftAddress: string) => {
        try {
            // Get token info directly from the OFT adapter
            const signer = await client.getSignerForExternal()
            const oft = new ethers.Contract(oftAddress, [
                'function token() external view returns (address)',
                'function name() external view returns (string)',
                'function symbol() external view returns (string)',
                'function decimals() external view returns (uint8)'
            ], signer)
            
            // First try to get the underlying token address
            let tokenAddress: string
            let tokenName: string
            let tokenSymbol: string
            let tokenDecimals: number
            
            try {
                // Try to get underlying token (for adapters)
                tokenAddress = await oft.token()
                console.log('Underlying token address:', tokenAddress)
                
                // Get token information from the underlying token
                const tokenContract = new ethers.Contract(tokenAddress, [
                    'function name() external view returns (string)',
                    'function symbol() external view returns (string)',
                    'function decimals() external view returns (uint8)'
                ], signer)
                
                tokenName = await tokenContract.name()
                tokenSymbol = await tokenContract.symbol()
                tokenDecimals = await tokenContract.decimals()
            } catch {
                // If that fails, try to get info directly from the OFT (for regular OFTs)
                console.log('Trying to get token info directly from OFT...')
                tokenAddress = oftAddress
                tokenName = await oft.name()
                tokenSymbol = await oft.symbol()
                tokenDecimals = await oft.decimals()
            }
            
            console.log('🎯 Token Details:')
            console.log('  Name:', tokenName)
            console.log('  Symbol:', tokenSymbol)
            console.log('  Decimals:', tokenDecimals)
            console.log('  Amount to send:', transferData.amount, tokenSymbol)
            
            const tokenInfo = {
                name: tokenName,
                symbol: tokenSymbol,
                decimals: tokenDecimals,
                address: tokenAddress
            }
            
            setTokenInfo(tokenInfo)
        } catch (error) {
            console.log('Could not get token info:', error)
            setTokenInfo(null)
        }
    }



    const getQuote = async () => {
        if (!transferData.amount || !transferData.to || !transferData.oftAddress) {
            onError('Please fill in all required fields')
            return
        }

        // Validate address format
        if (!transferData.oftAddress.startsWith('0x') || transferData.oftAddress.length !== 42) {
            onError('Invalid OFT adapter address format. Must be a valid Ethereum address.')
            return
        }

        if (!transferData.to.startsWith('0x') || transferData.to.length !== 42) {
            onError('Invalid recipient address format. Must be a valid Ethereum address.')
            return
        }

        // Validate amount
        const amount = parseFloat(transferData.amount)
        if (isNaN(amount) || amount <= 0) {
            onError('Invalid amount. Must be a positive number.')
            return
        }

        setQuoteLoading(true)
        setQuote(null)

        try {
            // Get the correct srcEid based on current network
            const currentSrcEid = await client.getCurrentSrcEid()
            console.log('Current srcEid:', currentSrcEid)
            
            // Update the transfer data with the correct srcEid
            const updatedTransferData = {
                ...transferData,
                srcEid: currentSrcEid
            }
            
            console.log('Updated transfer data:', updatedTransferData)
            
            const quoteResult = await client.quoteSend(updatedTransferData)
            setQuote(quoteResult)
            
            // Update token info if available
            if (quoteResult.tokenInfo) {
                setTokenInfo(quoteResult.tokenInfo)
            }
        } catch (error) {
            console.error('Quote error:', error)
            const errorMessage = error instanceof Error ? error.message : 'Failed to get quote'
            onError(errorMessage)
        } finally {
            setQuoteLoading(false)
        }
    }

    const handleTransfer = async () => {
        if (!transferData.amount || !transferData.to || !transferData.oftAddress) {
            onError('Please fill in all required fields')
            return
        }

        // Validate address format
        if (!transferData.oftAddress.startsWith('0x') || transferData.oftAddress.length !== 42) {
            onError('Invalid OFT adapter address format. Must be a valid Ethereum address.')
            return
        }

        if (!transferData.to.startsWith('0x') || transferData.to.length !== 42) {
            onError('Invalid recipient address format. Must be a valid Ethereum address.')
            return
        }

        // Validate amount
        const amount = parseFloat(transferData.amount)
        if (isNaN(amount) || amount <= 0) {
            onError('Invalid amount. Must be a positive number.')
            return
        }

        setLoading(true)

        try {
            // Get the correct srcEid based on current network
            const currentSrcEid = await client.getCurrentSrcEid()
            
            // Update the transfer data with the correct srcEid
            const updatedTransferData = {
                ...transferData,
                srcEid: currentSrcEid
            }
            
            const result = await client.sendTokens(updatedTransferData)
            onTransfer(result)
            setQuote(null)
        } catch (error) {
            console.error('Transfer error:', error)
            const errorMessage = error instanceof Error ? error.message : 'Transfer failed'
            onError(errorMessage)
        } finally {
            setLoading(false)
        }
    }

    const formatEther = (wei: string) => {
        return (parseInt(wei) / 1e18).toFixed(6)
    }

    return (
        <div className="transfer-form">
            <h2>Cross-Chain Token Transfer</h2>
            
            <div className="form-group">
                <label htmlFor="oftAddress">OFT Adapter Address:</label>
                <div className="field-help">
                    Enter the OFT adapter contract address for the token you want to transfer.
                    <br />
                    <small>Examples: USDC (0x176211869cA2b568f2A7D4EE941E073a821EE1ff), USDT (0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238)</small>
                </div>
                <input
                    type="text"
                    id="oftAddress"
                    value={transferData.oftAddress}
                    onChange={(e) => handleInputChange('oftAddress', e.target.value)}
                    placeholder="0x1234567890abcdef..."
                    required
                />
                
                {tokenInfo && (
                    <div className="token-details-display">
                        <h3>🎯 Token Details</h3>
                        <div className="token-details-grid">
                            <div className="token-detail-item">
                                <span className="detail-label">Name:</span>
                                <span className="detail-value">{tokenInfo.name}</span>
                            </div>
                            <div className="token-detail-item">
                                <span className="detail-label">Symbol:</span>
                                <span className="detail-value">{tokenInfo.symbol}</span>
                            </div>
                            <div className="token-detail-item">
                                <span className="detail-label">Decimals:</span>
                                <span className="detail-value">{tokenInfo.decimals}</span>
                            </div>
                            <div className="token-detail-item">
                                <span className="detail-label">Amount to send:</span>
                                <span className="detail-value">{transferData.amount} {tokenInfo.symbol}</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="form-group">
                <label htmlFor="dstEid">Destination Network:</label>
                <select
                    id="dstEid"
                    value={transferData.dstEid}
                    onChange={(e) => handleInputChange('dstEid', parseInt(e.target.value))}
                >
                    <option value={30101}>Ethereum Mainnet (30101)</option>
                    <option value={30102}>BSC Mainnet (30102)</option>
                    <option value={30109}>Polygon Mainnet (30109)</option>
                </select>
            </div>

            <div className="form-group">
                <label htmlFor="to">Recipient Address:</label>
                <input
                    type="text"
                    id="to"
                    value={transferData.to}
                    onChange={(e) => handleInputChange('to', e.target.value)}
                    placeholder="0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6"
                    required
                />
            </div>



            <div className="form-group">
                <label htmlFor="amount">Amount:</label>
                <input
                    type="text"
                    id="amount"
                    value={transferData.amount}
                    onChange={(e) => handleInputChange('amount', e.target.value)}
                    placeholder="0.1"
                    required
                />
            </div>

            <div className="form-actions">
                <button
                    type="button"
                    onClick={getQuote}
                    disabled={quoteLoading}
                    className="btn btn-secondary"
                >
                    {quoteLoading ? 'Getting Quote...' : 'Get Quote'}
                </button>
                
                <button
                    type="button"
                    onClick={handleTransfer}
                    disabled={loading}
                    className="btn btn-primary"
                >
                    {loading ? 'Sending...' : 'Send Tokens'}
                </button>
            </div>

            {quote && (
                <div className="quote-display">
                    <h3>Transfer Quote</h3>
                    <div className="quote-item">
                        <span>Native Fee:</span>
                        <span>{formatEther(quote.nativeFee.toString())} ETH</span>
                    </div>
                    <div className="quote-item">
                        <span>LZ Token Fee:</span>
                        <span>{formatEther(quote.lzTokenFee.toString())} LZ</span>
                    </div>
                </div>
            )}
        </div>
    )
} 