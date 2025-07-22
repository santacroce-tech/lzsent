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
    const [debugInfo, setDebugInfo] = useState<string[]>([])
    const [approvalStatus, setApprovalStatus] = useState<'none' | 'checking' | 'needed' | 'approving' | 'approved' | 'failed'>('none')

    const addDebugInfo = (message: string) => {
        console.log(`🔍 DEBUG: ${message}`)
        setDebugInfo(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`])
    }

    const clearDebugInfo = () => {
        setDebugInfo([])
    }

    const checkAndHandleApproval = async (tokenAddress: string, oftAddress: string, amount: string, decimals: number) => {
        setApprovalStatus('checking')
        addDebugInfo('Checking token allowance...')
        
        try {
            const signer = await client.getSignerForExternal()
            const tokenContract = new ethers.Contract(tokenAddress, [
                'function allowance(address owner, address spender) external view returns (uint256)',
                'function approve(address spender, uint256 amount) external returns (bool)'
            ], signer)
            
            const signerAddress = await signer.getAddress()
            const currentAllowance = await tokenContract.allowance(signerAddress, oftAddress)
            const amountToSend = ethers.parseUnits(amount, decimals)
            
            addDebugInfo(`Current allowance: ${ethers.formatUnits(currentAllowance, decimals)}`)
            addDebugInfo(`Required amount: ${ethers.formatUnits(amountToSend, decimals)}`)
            
            if (currentAllowance >= amountToSend) {
                setApprovalStatus('approved')
                addDebugInfo('✅ Sufficient allowance already exists')
                return true
            } else {
                setApprovalStatus('needed')
                addDebugInfo('⚠️ Insufficient allowance - approval needed')
                return false
            }
        } catch (error) {
            setApprovalStatus('failed')
            addDebugInfo(`❌ Could not check allowance: ${error}`)
            return false
        }
    }

    const handleApproval = async (tokenAddress: string, oftAddress: string, amount: string, decimals: number) => {
        setApprovalStatus('approving')
        addDebugInfo('Requesting token approval...')
        addDebugInfo('MetaMask popup should appear for approval...')
        
        try {
            const signer = await client.getSignerForExternal()
            const tokenContract = new ethers.Contract(tokenAddress, [
                'function approve(address spender, uint256 amount) external returns (bool)',
                'function allowance(address owner, address spender) external view returns (uint256)'
            ], signer)
            
            const amountToSend = ethers.parseUnits(amount, decimals)
            
            // Request approval - this should trigger MetaMask popup
            addDebugInfo('Sending approval transaction...')
            const approveTx = await tokenContract.approve(oftAddress, amountToSend)
            addDebugInfo(`Approval transaction sent: ${approveTx.hash}`)
            addDebugInfo('Waiting for approval confirmation...')
            
            // Wait for confirmation
            const receipt = await approveTx.wait()
            addDebugInfo(`Approval confirmed in block: ${receipt.blockNumber}`)
            
            // Verify the new allowance
            const signerAddress = await signer.getAddress()
            const newAllowance = await tokenContract.allowance(signerAddress, oftAddress)
            
            if (newAllowance >= amountToSend) {
                setApprovalStatus('approved')
                addDebugInfo('✅ Approval successful')
                return true
            } else {
                setApprovalStatus('failed')
                addDebugInfo('❌ Approval failed - insufficient allowance after approval')
                return false
            }
        } catch (error) {
            setApprovalStatus('failed')
            addDebugInfo(`❌ Approval failed: ${error}`)
            return false
        }
    }

    const handleInputChange = (field: keyof TransferData, value: string | number) => {
        setTransferData(prev => ({
            ...prev,
            [field]: value
        }))
        
        // If OFT address changed, try to get token info immediately and reset approval status
        if (field === 'oftAddress' && typeof value === 'string' && value.startsWith('0x') && value.length === 42) {
            setApprovalStatus('none') // Reset approval status for new token
            getTokenInfo(value)
        }
    }

    const getTokenInfo = async (oftAddress: string) => {
        try {
            addDebugInfo(`Getting token info for OFT address: ${oftAddress}`)
            
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
                addDebugInfo(`Underlying token address: ${tokenAddress}`)
                
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
                addDebugInfo('Trying to get token info directly from OFT...')
                tokenAddress = oftAddress
                tokenName = await oft.name()
                tokenSymbol = await oft.symbol()
                tokenDecimals = await oft.decimals()
            }
            
            addDebugInfo(`Token Details - Name: ${tokenName}, Symbol: ${tokenSymbol}, Decimals: ${tokenDecimals}`)
            addDebugInfo(`Amount to send: ${transferData.amount} ${tokenSymbol}`)
            
            const tokenInfo = {
                name: tokenName,
                symbol: tokenSymbol,
                decimals: tokenDecimals,
                address: tokenAddress
            }
            
            setTokenInfo(tokenInfo)
        } catch (error) {
            addDebugInfo(`Could not get token info: ${error}`)
            setTokenInfo(null)
        }
    }

    const getQuote = async () => {
        clearDebugInfo()
        addDebugInfo('Starting quote process...')
        
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
            addDebugInfo(`Current srcEid: ${currentSrcEid}`)
            
            // Update the transfer data with the correct srcEid
            const updatedTransferData = {
                ...transferData,
                srcEid: currentSrcEid
            }
            
            addDebugInfo(`Transfer data: ${JSON.stringify(updatedTransferData, null, 2)}`)
            
            const quoteResult = await client.quoteSend(updatedTransferData)
            setQuote(quoteResult)
            
            // Update token info if available
            if (quoteResult.tokenInfo) {
                setTokenInfo(quoteResult.tokenInfo)
            }
            
            addDebugInfo(`Quote successful - Native fee: ${quoteResult.nativeFee}, LZ fee: ${quoteResult.lzTokenFee}`)
        } catch (error) {
            console.error('Quote error:', error)
            addDebugInfo(`Quote error: ${error}`)
            const errorMessage = error instanceof Error ? error.message : 'Failed to get quote'
            onError(errorMessage)
        } finally {
            setQuoteLoading(false)
        }
    }

    const handleTransfer = async () => {
        clearDebugInfo()
        addDebugInfo('Starting transfer process...')
        
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
            // Validate OFT adapter first
            addDebugInfo('Validating OFT adapter...')
            const validation = await client.validateOFTAdapter(transferData.oftAddress)
            if (!validation.isValid) {
                throw new Error(`OFT adapter validation failed: ${validation.error}`)
            }
            addDebugInfo('✅ OFT adapter validation passed')
            
            // Check network compatibility
            addDebugInfo('Checking network compatibility...')
            const networkCheck = await client.checkNetworkCompatibility(transferData.oftAddress)
            addDebugInfo(`Current network: ${networkCheck.currentNetwork}`)
            
            if (!networkCheck.isCompatible) {
                addDebugInfo(`❌ Network compatibility issue: ${networkCheck.error}`)
                if (networkCheck.recommendations) {
                    networkCheck.recommendations.forEach(rec => addDebugInfo(`💡 Recommendation: ${rec}`))
                }
                throw new Error(`Network compatibility issue: ${networkCheck.error}`)
            }
            addDebugInfo('✅ Network compatibility check passed')
            
            // Check OFT adapter support for specific destination and amount
            if (tokenInfo) {
                addDebugInfo('Checking OFT adapter support for destination and amount...')
                const supportCheck = await client.checkOFTAdapterSupport(
                    transferData.oftAddress,
                    transferData.dstEid,
                    transferData.amount,
                    tokenInfo.decimals
                )
                
                if (!supportCheck.isSupported) {
                    addDebugInfo(`❌ OFT adapter support issue: ${supportCheck.error}`)
                    if (supportCheck.recommendations) {
                        supportCheck.recommendations.forEach(rec => addDebugInfo(`💡 Recommendation: ${rec}`))
                    }
                    throw new Error(`OFT adapter support issue: ${supportCheck.error}`)
                }
                addDebugInfo('✅ OFT adapter support check passed')
            }
            
            // Get the correct srcEid based on current network
            const currentSrcEid = await client.getCurrentSrcEid()
            addDebugInfo(`Current srcEid: ${currentSrcEid}`)
            
            // Update the transfer data with the correct srcEid
            const updatedTransferData = {
                ...transferData,
                srcEid: currentSrcEid
            }
            
            addDebugInfo(`Transfer data: ${JSON.stringify(updatedTransferData, null, 2)}`)
            
            // Get signer address for debugging
            const signerAddress = await client.getSignerAddress()
            addDebugInfo(`Signer address: ${signerAddress}`)
            
            // Check balance before transfer
            const signer = await client.getSignerForExternal()
            const balance = await signer.provider.getBalance(signerAddress)
            addDebugInfo(`Signer ETH balance: ${ethers.formatEther(balance)} ETH`)
            
            // Check token balance if we have token info
            if (tokenInfo) {
                try {
                    const tokenContract = new ethers.Contract(tokenInfo.address, [
                        'function balanceOf(address owner) external view returns (uint256)',
                        'function allowance(address owner, address spender) external view returns (uint256)'
                    ], signer)
                    
                    const tokenBalance = await tokenContract.balanceOf(signerAddress)
                    const tokenBalanceFormatted = ethers.formatUnits(tokenBalance, tokenInfo.decimals)
                    addDebugInfo(`Token balance: ${tokenBalanceFormatted} ${tokenInfo.symbol}`)
                    
                    // Check allowance for OFT adapter
                    const allowance = await tokenContract.allowance(signerAddress, transferData.oftAddress)
                    const allowanceFormatted = ethers.formatUnits(allowance, tokenInfo.decimals)
                    addDebugInfo(`Allowance for OFT: ${allowanceFormatted} ${tokenInfo.symbol}`)
                    
                    // Check if we have enough balance
                    const amountToSend = ethers.parseUnits(transferData.amount, tokenInfo.decimals)
                    if (tokenBalance < amountToSend) {
                        throw new Error(`Insufficient token balance. Have: ${tokenBalanceFormatted} ${tokenInfo.symbol}, Need: ${transferData.amount} ${tokenInfo.symbol}`)
                    }
                    
                    // Check and handle approval
                    const hasSufficientAllowance = await checkAndHandleApproval(
                        tokenInfo.address, 
                        transferData.oftAddress, 
                        transferData.amount, 
                        tokenInfo.decimals
                    )
                    
                    if (!hasSufficientAllowance) {
                        addDebugInfo('Approval needed before transfer')
                        addDebugInfo('Requesting approval from MetaMask...')
                        
                        const approvalSuccess = await handleApproval(
                            tokenInfo.address, 
                            transferData.oftAddress, 
                            transferData.amount, 
                            tokenInfo.decimals
                        )
                        
                        if (!approvalSuccess) {
                            throw new Error('Token approval failed. Please try again.')
                        }
                        
                        addDebugInfo('✅ Approval successful, proceeding with transfer...')
                    } else {
                        addDebugInfo('✅ Sufficient allowance already exists')
                    }
                } catch (error) {
                    addDebugInfo(`Could not check token balance: ${error}`)
                }
            }
            
            const result = await client.sendTokens(updatedTransferData)
            console.log('🔍 TransferForm: Received result from sendTokens:', result)
            console.log('🔍 TransferForm: result.txHash:', result.txHash)
            console.log('🔍 TransferForm: result.scanLink:', result.scanLink)
            console.log('🔍 TransferForm: result type:', typeof result)
            console.log('🔍 TransferForm: result keys:', Object.keys(result))
            
            addDebugInfo(`Transfer successful! TX Hash: ${result.txHash}`)
            addDebugInfo(`LayerZero Scan Link: ${result.scanLink}`)
            
            // Call the onTransfer callback to show the result modal
            console.log('🎉 Transfer completed successfully!')
            console.log('Transaction result:', result)
            onTransfer(result)
            setQuote(null)
        } catch (error) {
            console.error('Transfer error:', error)
            addDebugInfo(`Transfer error: ${error}`)
            
            // Enhanced error analysis
            if (error instanceof Error) {
                const errorMessage = error.message
                addDebugInfo(`Error message: ${errorMessage}`)
                
                // Check for specific error patterns
                if (errorMessage.includes('execution reverted')) {
                    addDebugInfo('Transaction reverted - this usually means a smart contract validation failed')
                    addDebugInfo('Common causes: insufficient balance, insufficient allowance, invalid parameters')
                }
                
                if (errorMessage.includes('require(false)')) {
                    addDebugInfo('Smart contract has a require(false) condition - this indicates a validation failure')
                    addDebugInfo('Check: token balance, allowance, network compatibility, parameter validity')
                }
                
                if (errorMessage.includes('insufficient funds')) {
                    addDebugInfo('Insufficient ETH for gas fees')
                }
                
                if (errorMessage.includes('user rejected')) {
                    addDebugInfo('User rejected the transaction in MetaMask')
                }
            }
            
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
                
                <div style={{ marginBottom: '1rem' }}>
                    <label htmlFor="commonOFT" style={{ fontSize: '0.9rem', color: '#6c757d' }}>
                        Quick select common tokens:
                    </label>
                    <select
                        id="commonOFT"
                        onChange={(e) => {
                            if (e.target.value) {
                                handleInputChange('oftAddress', e.target.value)
                            }
                        }}
                        style={{ 
                            width: '100%', 
                            padding: '0.5rem', 
                            marginTop: '0.25rem',
                            fontSize: '0.9rem'
                        }}
                    >
                        <option value="">Select a common token...</option>
                        <option value="0x176211869cA2b568f2A7D4EE941E073a821EE1ff">USDC (Ethereum/Polygon)</option>
                        <option value="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238">USDT (Ethereum/Polygon)</option>
                        <option value="0x9aF3b7DC29D3C4A1D9eC55F6B2026655c43f4d4a">USDC (BSC)</option>
                        <option value="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238">USDT (BSC)</option>
                    </select>
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
                
                <button
                    type="button"
                    onClick={async () => {
                        clearDebugInfo()
                        addDebugInfo('🔍 Manual OFT adapter check...')
                        
                        if (!transferData.oftAddress) {
                            addDebugInfo('❌ No OFT address provided')
                            return
                        }
                        
                        try {
                            // Check network compatibility
                            addDebugInfo('Checking network compatibility...')
                            const networkCheck = await client.checkNetworkCompatibility(transferData.oftAddress)
                            addDebugInfo(`Current network: ${networkCheck.currentNetwork}`)
                            
                            if (networkCheck.isCompatible) {
                                addDebugInfo('✅ Network compatibility check passed')
                                if (networkCheck.recommendations) {
                                    networkCheck.recommendations.forEach(rec => addDebugInfo(`💡 ${rec}`))
                                }
                            } else {
                                addDebugInfo(`❌ Network compatibility issue: ${networkCheck.error}`)
                                if (networkCheck.recommendations) {
                                    networkCheck.recommendations.forEach(rec => addDebugInfo(`💡 Recommendation: ${rec}`))
                                }
                            }
                            
                            // Validate OFT adapter
                            addDebugInfo('Validating OFT adapter...')
                            const validation = await client.validateOFTAdapter(transferData.oftAddress)
                            if (validation.isValid) {
                                addDebugInfo('✅ OFT adapter validation passed')
                            } else {
                                addDebugInfo(`❌ OFT adapter validation failed: ${validation.error}`)
                            }
                            
                            // Check OFT adapter support for specific destination and amount
                            if (tokenInfo) {
                                addDebugInfo('Checking OFT adapter support for destination and amount...')
                                const supportCheck = await client.checkOFTAdapterSupport(
                                    transferData.oftAddress,
                                    transferData.dstEid,
                                    transferData.amount,
                                    tokenInfo.decimals
                                )
                                
                                if (supportCheck.isSupported) {
                                    addDebugInfo('✅ OFT adapter support check passed')
                                    if (supportCheck.recommendations) {
                                        supportCheck.recommendations.forEach(rec => addDebugInfo(`💡 ${rec}`))
                                    }
                                } else {
                                    addDebugInfo(`❌ OFT adapter support issue: ${supportCheck.error}`)
                                    if (supportCheck.recommendations) {
                                        supportCheck.recommendations.forEach(rec => addDebugInfo(`💡 Recommendation: ${rec}`))
                                    }
                                }
                            } else {
                                addDebugInfo('⚠️ No token info available for support check')
                            }
                            
                        } catch (error) {
                            addDebugInfo(`❌ Check failed: ${error}`)
                        }
                    }}
                    className="btn btn-small"
                    style={{ backgroundColor: '#6c757d', color: 'white' }}
                >
                    Check OFT
                </button>
            </div>

            {/* Approval Status Indicator */}
            {approvalStatus !== 'none' && (
                <div className="approval-status" style={{
                    background: approvalStatus === 'approved' ? '#d4edda' : 
                               approvalStatus === 'failed' ? '#f8d7da' : 
                               approvalStatus === 'approving' ? '#fff3cd' : '#e2e3e5',
                    border: approvalStatus === 'approved' ? '1px solid #c3e6cb' : 
                            approvalStatus === 'failed' ? '1px solid #f5c6cb' : 
                            approvalStatus === 'approving' ? '1px solid #ffeaa7' : '1px solid #d1ecf1',
                    borderRadius: '8px',
                    padding: '1rem',
                    marginTop: '1rem',
                    textAlign: 'center'
                }}>
                    {approvalStatus === 'checking' && (
                        <div>
                            <div className="spinner" style={{ margin: '0 auto 0.5rem' }}></div>
                            <strong>Checking token allowance...</strong>
                        </div>
                    )}
                    {approvalStatus === 'needed' && (
                        <div>
                            <strong style={{ color: '#856404' }}>⚠️ Token approval needed</strong>
                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: '#856404' }}>
                                You need to approve the OFT adapter to spend your tokens before transferring.
                            </p>
                        </div>
                    )}
                    {approvalStatus === 'approving' && (
                        <div>
                            <div className="spinner" style={{ margin: '0 auto 0.5rem' }}></div>
                            <strong style={{ color: '#856404' }}>Approving tokens...</strong>
                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: '#856404' }}>
                                Please confirm the approval transaction in MetaMask.
                            </p>
                        </div>
                    )}
                    {approvalStatus === 'approved' && (
                        <div>
                            <strong style={{ color: '#155724' }}>✅ Token approval successful</strong>
                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: '#155724' }}>
                                You can now proceed with the transfer.
                            </p>
                        </div>
                    )}
                    {approvalStatus === 'failed' && (
                        <div>
                            <strong style={{ color: '#721c24' }}>❌ Token approval failed</strong>
                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: '#721c24' }}>
                                Please try the approval again or check your MetaMask connection.
                            </p>
                        </div>
                    )}
                </div>
            )}

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

            {/* Debug Information */}
            {debugInfo.length > 0 && (
                <div className="debug-info">
                    <h3>🔍 Debug Information</h3>
                    <button 
                        onClick={clearDebugInfo}
                        className="btn btn-small"
                        style={{ marginBottom: '10px' }}
                    >
                        Clear Debug
                    </button>
                    <div className="debug-log">
                        {debugInfo.map((info, index) => (
                            <div key={index} className="debug-line">
                                {info}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
} 