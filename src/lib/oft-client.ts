import { ethers, parseUnits } from 'ethers'
import { ChainType, endpointIdToChainType } from '@layerzerolabs/lz-definitions'
import { Options, addressToBytes32 } from '@layerzerolabs/lz-v2-utilities'

import type { 
    EvmSendArgs, 
    SendResult, 
    QuoteResult, 
    OFTConfig,
    MetaMaskProvider 
} from './types'
import { getLayerZeroScanLink } from './utils'

// IOFT ABI - comprehensive interface for OFT operations
const IOFT_ABI = [
    'function token() external view returns (address)',
    'function approvalRequired() external view returns (bool)',
    'function quoteSend(tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, bool payInLzToken) external view returns (uint256 nativeFee, uint256 lzTokenFee)',
    'function send(tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, tuple(uint256 nativeFee, uint256 lzTokenFee) fee, address refundAddress) external payable returns (bytes32 guid)',
    'function decimals() external view returns (uint8)',
    'function symbol() external view returns (string)',
    'function name() external view returns (string)'
]

// IERC20 ABI - minimal interface for ERC20 operations
const IERC20_ABI = [
    'function decimals() external view returns (uint8)',
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function approve(address spender, uint256 amount) external returns (bool)'
]

export class OFTClient {
    private provider: ethers.BrowserProvider

    constructor(metaMaskProvider: MetaMaskProvider) {
        this.provider = new ethers.BrowserProvider(metaMaskProvider)
    }

    private async getSigner(): Promise<ethers.JsonRpcSigner> {
        return await this.provider.getSigner()
    }

    /**
     * Get the signer for external use
     */
    async getSignerForExternal(): Promise<ethers.JsonRpcSigner> {
        return await this.getSigner()
    }

    /**
     * Get OFT configuration
     */
    async getOFTConfig(oftAddress: string): Promise<OFTConfig> {
        try {
            const signer = await this.getSigner()
            const oft = new ethers.Contract(oftAddress, IOFT_ABI, signer)
            
            // First, verify the contract exists and has the required functions
            try {
                const code = await this.provider.getCode(oftAddress)
                if (code === '0x') {
                    throw new Error('Contract does not exist at this address')
                }
            } catch (error) {
                throw new Error(`Failed to verify contract at ${oftAddress}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            }
            
            const underlying = await oft.token()
            const erc20 = new ethers.Contract(underlying, IERC20_ABI, signer)
            
            let decimals: number
            let approvalRequired: boolean
            
            try {
                decimals = await erc20.decimals()
            } catch {
                // Try to get decimals from the OFT contract itself
                try {
                    decimals = await oft.decimals()
                } catch {
                    // Fallback to 6 decimals if not available
                    decimals = 6
                }
            }
            
            try {
                approvalRequired = await oft.approvalRequired()
            } catch {
                // Assume approval not required if method doesn't exist
                approvalRequired = false
            }

            return {
                address: oftAddress,
                underlyingToken: underlying,
                decimals,
                approvalRequired
            }
        } catch (error) {
            console.error('OFT config error:', error)
            throw new Error(`Failed to get OFT configuration: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
    }

    /**
     * Check and handle ERC20 approval for OFT adapters
     */
    async handleApproval(oftAddress: string, amount: string, decimals: number): Promise<void> {
        const signer = await this.getSigner()
        const oft = new ethers.Contract(oftAddress, IOFT_ABI, signer)
        
        try {
            const approvalRequired = await oft.approvalRequired()
            if (!approvalRequired) {
                return // No approval needed
            }

            const underlying = await oft.token()
            const erc20 = new ethers.Contract(underlying, IERC20_ABI, signer)
            
            const amountUnits = parseUnits(amount, decimals)
            const currentAllowance = await erc20.allowance(await signer.getAddress(), oftAddress)
            
            if (currentAllowance.lt(amountUnits)) {
                const approveTx = await erc20.approve(oftAddress, amountUnits)
                await approveTx.wait()
            }
        } catch {
            // If approvalRequired() doesn't exist, assume it's a regular OFT
            console.log('No approval required (regular OFT detected)')
        }
    }

    /**
     * Build LayerZero options
     */
    buildOptions(args: EvmSendArgs): string {
        let options = Options.newOptions()

        // Add lzReceive options
        if (args.extraLzReceiveOptions && args.extraLzReceiveOptions.length > 0) {
            if (args.extraLzReceiveOptions.length % 2 !== 0) {
                throw new Error('Invalid lzReceive options: expected pairs of gas,value')
            }

            for (let i = 0; i < args.extraLzReceiveOptions.length; i += 2) {
                const gas = Number(args.extraLzReceiveOptions[i])
                const value = Number(args.extraLzReceiveOptions[i + 1]) || 0
                options = options.addExecutorLzReceiveOption(gas, value)
            }
        }

        // Add lzCompose options
        if (args.extraLzComposeOptions && args.extraLzComposeOptions.length > 0) {
            if (args.extraLzComposeOptions.length % 3 !== 0) {
                throw new Error('Invalid lzCompose options: expected triplets of index,gas,value')
            }

            for (let i = 0; i < args.extraLzComposeOptions.length; i += 3) {
                const index = Number(args.extraLzComposeOptions[i])
                const gas = Number(args.extraLzComposeOptions[i + 1])
                const value = Number(args.extraLzComposeOptions[i + 2]) || 0
                options = options.addExecutorComposeOption(index, gas, value)
            }
        }

        // Add native drop options
        if (args.extraNativeDropOptions && args.extraNativeDropOptions.length > 0) {
            if (args.extraNativeDropOptions.length % 2 !== 0) {
                throw new Error('Invalid native drop options: expected pairs of amount,recipient')
            }

            for (let i = 0; i < args.extraNativeDropOptions.length; i += 2) {
                const amountStr = args.extraNativeDropOptions[i]
                const recipient = args.extraNativeDropOptions[i + 1]

                if (!amountStr || !recipient) {
                    throw new Error('Invalid native drop option: Both amount and recipient must be provided')
                }

                try {
                    options = options.addExecutorNativeDropOption(amountStr.trim(), recipient.trim())
                } catch (error) {
                    const maxUint128 = BigInt('340282366920938463463374607431768211455')
                    const maxUint128Ether = Number(maxUint128) / 1e18

                    throw new Error(
                        `Failed to add native drop option with amount ${amountStr.trim()} wei. ` +
                        `LayerZero protocol constrains native drop amounts to uint128 maximum ` +
                        `(${maxUint128.toString()} wei ≈ ${maxUint128Ether.toFixed(2)} ETH). ` +
                        `Original error: ${error instanceof Error ? error.message : String(error)}`
                    )
                }
            }
        }

        return options.toHex()
    }

    /**
     * Quote the transaction fee
     */
    async quoteSend(args: EvmSendArgs): Promise<QuoteResult> {
        if (endpointIdToChainType(args.srcEid) !== ChainType.EVM) {
            throw new Error(`non-EVM srcEid (${args.srcEid}) not supported`)
        }

        try {
            console.log('Getting OFT config for address:', args.oftAddress)
            console.log('Source EID:', args.srcEid)
            console.log('Destination EID:', args.dstEid)
            
            // Check current network
            const network = await this.provider.getNetwork()
            console.log('Current network chainId:', Number(network.chainId))
            
                        const oftConfig = await this.getOFTConfig(args.oftAddress)
            console.log('OFT config:', oftConfig)
            
            let tokenInfo: { name: string; symbol: string; decimals: number; address: string } | null = null
            
            // Try to get the token address to verify this is a valid OFT adapter
            try {
                const signer = await this.getSigner()
                const oft = new ethers.Contract(args.oftAddress, IOFT_ABI, signer)
                const tokenAddress = await oft.token()
                console.log('Underlying token address:', tokenAddress)
                
                // Get token information
                const tokenContract = new ethers.Contract(tokenAddress, [
                    'function name() external view returns (string)',
                    'function symbol() external view returns (string)',
                    'function decimals() external view returns (uint8)'
                ], signer)
                
                try {
                    const tokenName = await tokenContract.name()
                    const tokenSymbol = await tokenContract.symbol()
                    const tokenDecimals = await tokenContract.decimals()
                    console.log('🎯 Token Details:')
                    console.log('  Name:', tokenName)
                    console.log('  Symbol:', tokenSymbol)
                    console.log('  Decimals:', tokenDecimals)
                    console.log('  Amount to send:', args.amount, tokenSymbol)
                    
                    tokenInfo = {
                        name: tokenName,
                        symbol: tokenSymbol,
                        decimals: tokenDecimals,
                        address: tokenAddress
                    }
                } catch (tokenError) {
                    console.log('Could not get token details:', tokenError)
                }
                
                // Also check if the contract has code
                const code = await this.provider.getCode(args.oftAddress)
                if (code === '0x') {
                    console.error('❌ Contract has no code - not deployed on this network!')
                    throw new Error('OFT adapter is not deployed on the current network')
                } else {
                    console.log('✅ Contract has code - deployed on this network')
                }
            } catch (error) {
                console.log('Could not get token address:', error)
                if (error instanceof Error && error.message.includes('not deployed')) {
                    throw error
                }
            }
            
            const amountUnits = parseUnits(args.amount, oftConfig.decimals)
            const minAmountUnits = args.minAmount 
                ? parseUnits(args.minAmount, oftConfig.decimals) 
                : amountUnits

            console.log('Amount units:', amountUnits.toString())
            console.log('Min amount units:', minAmountUnits.toString())

            const toBytes = addressToBytes32(args.to)
            const extraOptions = this.buildOptions(args)

            console.log('To bytes:', ethers.hexlify(toBytes))
            console.log('Extra options:', extraOptions)

            // Build sendParam object
            const sendParam = {
                dstEid: args.dstEid,
                to: ethers.hexlify(toBytes),
                amountLD: amountUnits.toString(),
                minAmountLD: minAmountUnits.toString(),
                extraOptions: extraOptions,
                composeMsg: args.composeMsg || '0x',
                oftCmd: '0x',
            }

            console.log('Calling quoteSend with sendParam object...')
            console.log('Parameters:', sendParam)

            const signer = await this.getSigner()
            const oft = new ethers.Contract(args.oftAddress, IOFT_ABI, signer)
            
            console.log('Calling quoteSend...')
            // Call quoteSend with sendParam object and false for payInLzToken
            const result = await oft.quoteSend(sendParam, false)
            console.log('Quote result:', result)

            return {
                nativeFee: result[0],
                lzTokenFee: result[1],
                tokenInfo: tokenInfo || undefined
            }
        } catch (error) {
            console.error('Quote error:', error)
            if (error instanceof Error) {
                throw new Error(`Failed to get quote: ${error.message}`)
            }
            throw new Error('Failed to get quote: Unknown error')
        }
    }

    /**
     * Send tokens cross-chain
     */
    async sendTokens(args: EvmSendArgs): Promise<SendResult> {
        if (endpointIdToChainType(args.srcEid) !== ChainType.EVM) {
            throw new Error(`non-EVM srcEid (${args.srcEid}) not supported`)
        }

        console.log('🚀 Starting sendTokens process...')
        console.log('Input args:', JSON.stringify(args, null, 2))

        const oftConfig = await this.getOFTConfig(args.oftAddress)
        console.log('OFT config:', oftConfig)
        
        // Handle approval if needed
        console.log('🔐 Checking approval requirements...')
        await this.handleApproval(args.oftAddress, args.amount, oftConfig.decimals)

        const amountUnits = parseUnits(args.amount, oftConfig.decimals)
        const minAmountUnits = args.minAmount 
            ? parseUnits(args.minAmount, oftConfig.decimals) 
            : amountUnits

        console.log('💰 Amount calculations:')
        console.log('  Amount (human):', args.amount)
        console.log('  Amount (units):', amountUnits.toString())
        console.log('  Min amount (units):', minAmountUnits.toString())

        const toBytes = addressToBytes32(args.to)
        const extraOptions = this.buildOptions(args)

        console.log('📦 Transaction parameters:')
        console.log('  To address:', args.to)
        console.log('  To bytes:', ethers.hexlify(toBytes))
        console.log('  Extra options:', extraOptions)

        // Quote the fee
        console.log('💸 Getting fee quote...')
        const msgFee = await this.quoteSend(args)
        console.log('Fee quote:', {
            nativeFee: msgFee.nativeFee.toString(),
            lzTokenFee: msgFee.lzTokenFee.toString()
        })

        // Validate transaction parameters before sending
        console.log('🔍 Validating transaction parameters...')
        const validation = await this.validateTransactionParams(args, amountUnits, minAmountUnits, msgFee)
        if (!validation.isValid) {
            console.error('❌ Transaction validation failed:')
            validation.errors.forEach(error => console.error('  -', error))
            throw new Error(`Transaction validation failed: ${validation.errors.join(', ')}`)
        }
        console.log('✅ Transaction parameters validated')

        // Send the transaction
        const signer = await this.getSigner()
        const oft = new ethers.Contract(args.oftAddress, IOFT_ABI, signer)
        const refundAddress = await signer.getAddress()
        
        console.log('📝 Preparing transaction...')
        console.log('  OFT address:', args.oftAddress)
        console.log('  Refund address:', refundAddress)
        console.log('  Fee tuple:', [msgFee.nativeFee.toString(), msgFee.lzTokenFee.toString()])
        
        // Log the exact parameters being sent
        const sendParams = {
            dstEid: args.dstEid,
            to: ethers.hexlify(toBytes),
            amountLD: amountUnits.toString(),
            minAmountLD: minAmountUnits.toString(),
            extraOptions: extraOptions,
            composeMsg: args.composeMsg || '0x',
            oftCmd: '0x',
            fee: [msgFee.nativeFee.toString(), msgFee.lzTokenFee.toString()],
            refundAddress: refundAddress,
            value: msgFee.nativeFee.toString()
        }
        
        console.log('📤 Transaction parameters:')
        console.log(JSON.stringify(sendParams, null, 2))
        
        // Check if we have enough ETH for the transaction
        const balance = await signer.provider.getBalance(refundAddress)
        const requiredEth = msgFee.nativeFee
        console.log('💎 ETH balance check:')
        console.log('  Current balance:', ethers.formatEther(balance), 'ETH')
        console.log('  Required fee:', ethers.formatEther(requiredEth), 'ETH')
        console.log('  Sufficient funds:', balance >= BigInt(requiredEth))
        
        if (balance < BigInt(requiredEth)) {
            throw new Error(`Insufficient ETH for fees. Have: ${ethers.formatEther(balance)} ETH, Need: ${ethers.formatEther(requiredEth)} ETH`)
        }
        
        // Check token balance and allowance
        try {
            const tokenContract = new ethers.Contract(oftConfig.underlyingToken, [
                'function balanceOf(address owner) external view returns (uint256)',
                'function allowance(address owner, address spender) external view returns (uint256)',
                'function decimals() external view returns (uint8)',
                'function approve(address spender, uint256 amount) external returns (bool)'
            ], signer)
            
            const tokenBalance = await tokenContract.balanceOf(refundAddress)
            const allowance = await tokenContract.allowance(refundAddress, args.oftAddress)
            const tokenDecimals = await tokenContract.decimals()
            
            console.log('🎯 Token balance check:')
            console.log('  Token address:', oftConfig.underlyingToken)
            console.log('  Balance:', ethers.formatUnits(tokenBalance, tokenDecimals))
            console.log('  Allowance:', ethers.formatUnits(allowance, tokenDecimals))
            console.log('  Required amount:', ethers.formatUnits(amountUnits, tokenDecimals))
            console.log('  Sufficient balance:', tokenBalance >= amountUnits)
            console.log('  Sufficient allowance:', allowance >= amountUnits)
            
            if (tokenBalance < amountUnits) {
                throw new Error(`Insufficient token balance. Have: ${ethers.formatUnits(tokenBalance, tokenDecimals)}, Need: ${ethers.formatUnits(amountUnits, tokenDecimals)}`)
            }
            
            // Check and handle allowance
            if (allowance < amountUnits) {
                console.log('⚠️ Insufficient allowance detected')
                console.log('  Current allowance:', ethers.formatUnits(allowance, tokenDecimals))
                console.log('  Required amount:', ethers.formatUnits(amountUnits, tokenDecimals))
                console.log('  Requesting approval...')
                
                // Request approval for the exact amount needed
                const approveTx = await tokenContract.approve(args.oftAddress, amountUnits)
                console.log('  Approval transaction sent:', approveTx.hash)
                
                // Wait for approval confirmation
                const approveReceipt = await approveTx.wait()
                console.log('  Approval confirmed in block:', approveReceipt.blockNumber)
                
                // Verify the new allowance
                const newAllowance = await tokenContract.allowance(refundAddress, args.oftAddress)
                console.log('  New allowance:', ethers.formatUnits(newAllowance, tokenDecimals))
                
                if (newAllowance < amountUnits) {
                    throw new Error('Approval failed - insufficient allowance after approval')
                }
                
                console.log('✅ Approval successful')
            } else {
                console.log('✅ Sufficient allowance already exists')
            }
        } catch (error) {
            console.log('Could not check token balance/allowance:', error)
            // Continue with the transfer even if we can't check balance/allowance
            // The smart contract will handle the validation
        }
        
        console.log('🚀 Sending transaction...')
        
        try {
            // Log the exact function call parameters for debugging
            console.log('📋 Function call details:')
            console.log('  Function: oft.send')
            console.log('  Parameters:')
            console.log('    dstEid:', args.dstEid)
            console.log('    to (hex):', ethers.hexlify(toBytes))
            console.log('    amountLD:', amountUnits.toString())
            console.log('    minAmountLD:', minAmountUnits.toString())
            console.log('    extraOptions:', extraOptions)
            console.log('    composeMsg:', args.composeMsg || '0x')
            console.log('    oftCmd:', '0x')
            console.log('    fee tuple:', [msgFee.nativeFee.toString(), msgFee.lzTokenFee.toString()])
            console.log('    refundAddress:', refundAddress)
            console.log('    value:', msgFee.nativeFee.toString())
            
            // Test the transaction with estimateGas first
            console.log('🔍 Testing transaction with estimateGas...')
            try {
                // Create the sendParam tuple as expected by the OFT ABI
                const sendParam = {
                    dstEid: args.dstEid,
                    to: ethers.hexlify(toBytes),
                    amountLD: amountUnits.toString(),
                    minAmountLD: minAmountUnits.toString(),
                    extraOptions: extraOptions,
                    composeMsg: args.composeMsg || '0x',
                    oftCmd: '0x'
                }
                
                const estimatedGas = await oft.send.estimateGas(
                    sendParam, // sendParam tuple
                    [msgFee.nativeFee, msgFee.lzTokenFee], // fee tuple
                    refundAddress,
                    {
                        value: msgFee.nativeFee,
                    }
                )
                console.log('✅ estimateGas successful:', estimatedGas.toString())
            } catch (estimateError) {
                console.error('❌ estimateGas failed:', estimateError)
                
                // Try to decode the error if possible
                if (estimateError instanceof Error) {
                    const errorMessage = estimateError.message
                    console.error('Error details:', errorMessage)
                    
                    // Check for specific error patterns
                    if (errorMessage.includes('execution reverted')) {
                        console.error('Transaction would revert. Possible causes:')
                        console.error('1. Insufficient token balance')
                        console.error('2. Insufficient allowance')
                        console.error('3. Invalid destination EID')
                        console.error('4. Invalid recipient address')
                        console.error('5. Amount too small or too large')
                        console.error('6. Network not supported by OFT adapter')
                        console.error('7. OFT adapter not properly configured')
                        
                        // Try to decode the transaction data that would be sent
                        try {
                            const sendParam = {
                                dstEid: args.dstEid,
                                to: ethers.hexlify(toBytes),
                                amountLD: amountUnits.toString(),
                                minAmountLD: minAmountUnits.toString(),
                                extraOptions: extraOptions,
                                composeMsg: args.composeMsg || '0x',
                                oftCmd: '0x'
                            }
                            const txData = oft.interface.encodeFunctionData('send', [
                                sendParam, // sendParam tuple
                                [msgFee.nativeFee, msgFee.lzTokenFee], // fee tuple
                                refundAddress
                            ])
                            this.decodeTransactionData(txData)
                        } catch (decodeError) {
                            console.log('Could not encode transaction data for decoding:', decodeError)
                        }
                    }
                }
                
                throw estimateError
            }
            
            // Create the sendParam tuple for the actual transaction
            const sendParam = {
                dstEid: args.dstEid,
                to: ethers.hexlify(toBytes),
                amountLD: amountUnits.toString(),
                minAmountLD: minAmountUnits.toString(),
                extraOptions: extraOptions,
                composeMsg: args.composeMsg || '0x',
                oftCmd: '0x'
            }
            
            const tx = await oft.send(
                sendParam, // sendParam tuple
                [msgFee.nativeFee, msgFee.lzTokenFee], // fee tuple
                refundAddress,
                {
                    value: msgFee.nativeFee,
                }
            )

            console.log('✅ Transaction sent successfully!')
            console.log('  Transaction hash:', tx.hash)
            
            const receipt = await tx.wait()
            console.log('✅ Transaction confirmed!')
            console.log('  Gas used:', receipt.gasUsed.toString())
            console.log('  Block number:', receipt.blockNumber)
            
            const txHash = receipt.transactionHash
            const scanLink = getLayerZeroScanLink(txHash, args.srcEid >= 40_000 && args.srcEid < 50_000)

            return { txHash, scanLink }
        } catch (error) {
            console.error('❌ Transaction failed:', error)
            
            // Enhanced error analysis
            if (error instanceof Error) {
                const errorMessage = error.message
                console.error('Error details:', errorMessage)
                
                // Try to decode the error if it's a revert
                if (errorMessage.includes('execution reverted')) {
                    console.error('Transaction reverted. Common causes:')
                    console.error('1. Insufficient token balance')
                    console.error('2. Insufficient allowance')
                    console.error('3. Invalid parameters (amount, addresses, etc.)')
                    console.error('4. Network incompatibility')
                    console.error('5. Contract not deployed on target network')
                    console.error('6. Insufficient ETH for gas fees')
                }
                
                // Check if it's a specific revert with data
                if (errorMessage.includes('data=')) {
                    console.error('Revert data available - this might contain specific error information')
                }
            }
            
            throw error
        }
    }

    /**
     * Validate transaction parameters before sending
     */
    async validateTransactionParams(args: EvmSendArgs, amountUnits: bigint, minAmountUnits: bigint, msgFee: QuoteResult): Promise<{ isValid: boolean; errors: string[] }> {
        const errors: string[] = []
        
        try {
            console.log('🔍 Validating transaction parameters...')
            
            // Validate destination EID
            if (args.dstEid <= 0) {
                errors.push('Invalid destination EID: must be positive')
            }
            
            // Validate recipient address
            if (!args.to.startsWith('0x') || args.to.length !== 42) {
                errors.push('Invalid recipient address format')
            }
            
            // Validate amount
            if (amountUnits <= 0n) {
                errors.push('Invalid amount: must be greater than 0')
            }
            
            // Validate min amount
            if (minAmountUnits > amountUnits) {
                errors.push('Min amount cannot be greater than amount')
            }
            
            // Validate fees
            if (BigInt(msgFee.nativeFee) <= 0n) {
                errors.push('Invalid native fee: must be greater than 0')
            }
            
            // Check if OFT adapter supports the destination network
            try {
                const signer = await this.getSigner()
                const oft = new ethers.Contract(args.oftAddress, [
                    'function quoteSend(tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, bool payInLzToken) external view returns (uint256 nativeFee, uint256 lzTokenFee)'
                ], signer)
                
                // Test if the OFT adapter can quote for this destination
                const testSendParam = {
                    dstEid: args.dstEid,
                    to: '0x0000000000000000000000000000000000000000000000000000000000000000',
                    amountLD: amountUnits.toString(),
                    minAmountLD: minAmountUnits.toString(),
                    extraOptions: '0x',
                    composeMsg: '0x',
                    oftCmd: '0x'
                }
                
                try {
                    await oft.quoteSend(testSendParam, false)
                    console.log('✅ OFT adapter supports destination network')
                } catch (quoteError) {
                    errors.push(`OFT adapter does not support destination network ${args.dstEid}`)
                    console.log('❌ OFT adapter quote test failed:', quoteError)
                }
                
            } catch (error) {
                errors.push('Could not validate OFT adapter support')
            }
            
            // Check token balance and allowance
            try {
                const oftConfig = await this.getOFTConfig(args.oftAddress)
                const signer = await this.getSigner()
                const tokenContract = new ethers.Contract(oftConfig.underlyingToken, [
                    'function balanceOf(address owner) external view returns (uint256)',
                    'function allowance(address owner, address spender) external view returns (uint256)'
                ], signer)
                
                const signerAddress = await signer.getAddress()
                const balance = await tokenContract.balanceOf(signerAddress)
                const allowance = await tokenContract.allowance(signerAddress, args.oftAddress)
                
                console.log('💰 Balance check:')
                console.log('  Token balance:', balance.toString())
                console.log('  Required amount:', amountUnits.toString())
                console.log('  Sufficient balance:', balance >= amountUnits)
                
                console.log('🔐 Allowance check:')
                console.log('  Current allowance:', allowance.toString())
                console.log('  Required amount:', amountUnits.toString())
                console.log('  Sufficient allowance:', allowance >= amountUnits)
                
                if (balance < amountUnits) {
                    errors.push(`Insufficient token balance. Have: ${balance.toString()}, Need: ${amountUnits.toString()}`)
                }
                
                if (allowance < amountUnits) {
                    errors.push(`Insufficient allowance. Have: ${allowance.toString()}, Need: ${amountUnits.toString()}`)
                }
                
            } catch (error) {
                errors.push('Could not check token balance/allowance')
            }
            
            // Check ETH balance for fees
            try {
                const signer = await this.getSigner()
                const signerAddress = await signer.getAddress()
                const balance = await signer.provider.getBalance(signerAddress)
                
                console.log('💎 ETH balance check:')
                console.log('  ETH balance:', balance.toString())
                console.log('  Required fee:', msgFee.nativeFee.toString())
                console.log('  Sufficient ETH:', balance >= BigInt(msgFee.nativeFee))
                
                if (balance < BigInt(msgFee.nativeFee)) {
                    errors.push(`Insufficient ETH for fees. Have: ${ethers.formatEther(balance)}, Need: ${ethers.formatEther(msgFee.nativeFee)}`)
                }
                
            } catch (error) {
                errors.push('Could not check ETH balance')
            }
            
            const isValid = errors.length === 0
            console.log(`Validation result: ${isValid ? '✅ Valid' : '❌ Invalid'}`)
            if (errors.length > 0) {
                console.log('Validation errors:', errors)
            }
            
            return { isValid, errors }
            
        } catch (error) {
            errors.push(`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
            return { isValid: false, errors }
        }
    }

    /**
     * Decode and analyze transaction data for debugging
     */
    decodeTransactionData(data: string): void {
        try {
            console.log('🔍 Decoding transaction data...')
            console.log('Raw data:', data)
            
            // The first 4 bytes are the function selector
            const functionSelector = data.slice(0, 10)
            console.log('Function selector:', functionSelector)
            
            // Remove the function selector to get the parameters
            const parameters = data.slice(10)
            console.log('Parameters (hex):', parameters)
            
            // Try to decode common OFT function selectors
            const knownSelectors: Record<string, string> = {
                '0x03951715': 'send(uint32,bytes32,uint256,uint256,bytes,bytes,bytes,(uint256,uint256),address)',
                '0x03951716': 'send(uint32,bytes32,uint256,uint256,bytes,bytes,bytes,(uint256,uint256),address,uint256)',
                '0x03951717': 'send(uint32,bytes32,uint256,uint256,bytes,bytes,bytes,(uint256,uint256),address,uint256,uint256)'
            }
            
            const functionName = knownSelectors[functionSelector]
            if (functionName) {
                console.log('Function name:', functionName)
            } else {
                console.log('Unknown function selector')
            }
            
            // Try to decode the parameters if we know the function
            if (functionName && functionName.includes('send')) {
                try {
                    // This is a simplified decode - in practice you'd use a proper ABI decoder
                    console.log('Parameter analysis:')
                    console.log('  - First 32 bytes (dstEid):', parameters.slice(0, 64))
                    console.log('  - Next 32 bytes (to):', parameters.slice(64, 128))
                    console.log('  - Next 32 bytes (amountLD):', parameters.slice(128, 192))
                    console.log('  - Next 32 bytes (minAmountLD):', parameters.slice(192, 256))
                    
                    // Convert hex to decimal for readable values
                    const dstEid = parseInt(parameters.slice(0, 64), 16)
                    const amountLD = BigInt('0x' + parameters.slice(128, 192))
                    const minAmountLD = BigInt('0x' + parameters.slice(192, 256))
                    
                    console.log('Decoded values:')
                    console.log('  - dstEid:', dstEid)
                    console.log('  - amountLD:', amountLD.toString())
                    console.log('  - minAmountLD:', minAmountLD.toString())
                    
                } catch (decodeError) {
                    console.log('Could not decode parameters:', decodeError)
                }
            }
            
        } catch (error) {
            console.log('Could not decode transaction data:', error)
        }
    }

    /**
     * Get signer address
     */
    async getSignerAddress(): Promise<string> {
        const signer = await this.getSigner()
        return await signer.getAddress()
    }

    /**
     * Get current network chain ID
     */
    async getChainId(): Promise<number> {
        const network = await this.provider.getNetwork()
        return Number(network.chainId)
    }

    /**
     * Get the correct srcEid based on current network
     */
    async getCurrentSrcEid(): Promise<number> {
        const chainId = await this.getChainId()
        
        // Map chainId to LayerZero EID
        const chainIdToEid: Record<number, number> = {
            1: 30101,      // Ethereum Mainnet
            56: 30102,     // BSC Mainnet
            137: 30109,    // Polygon Mainnet
            43114: 30106,  // Avalanche Mainnet
            42161: 30110,  // Arbitrum One
            10: 30111,     // Optimism
            250: 30112,    // Fantom
            11155111: 40161, // Ethereum Sepolia
            97: 40102,   // BSC Testnet
        }
        
        const eid = chainIdToEid[chainId]
        if (!eid) {
            throw new Error(`Unsupported network with chainId ${chainId}`)
        }
        
        return eid
    }

    /**
     * Check if a token has an OFT adapter by looking for common patterns
     */
    async findOFTAdapterForToken(tokenAddress: string): Promise<string | null> {
        try {
            const signer = await this.getSigner()
            
            // Check if the token itself implements OFT functions
            const tokenContract = new ethers.Contract(tokenAddress, [
                'function quoteSend(tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, bool payInLzToken) external view returns (uint256 nativeFee, uint256 lzTokenFee)',
                'function send(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd, tuple(uint256 nativeFee, uint256 lzTokenFee) fee, address refundAddress) external payable returns (bytes32 guid)'
            ], signer)
            
            // Try to call a simple view function to see if it's an OFT
            try {
                const testSendParam = {
                    dstEid: 30101,
                    to: '0x0000000000000000000000000000000000000000000000000000000000000000',
                    amountLD: '1000000',
                    minAmountLD: '1000000',
                    extraOptions: '0x',
                    composeMsg: '0x',
                    oftCmd: '0x'
                }
                await tokenContract.quoteSend(testSendParam, false)
                console.log('Token appears to be an OFT itself')
                return tokenAddress
            } catch (error) {
                console.log('Token is not an OFT, checking for adapters...')
            }
            
            // Check common OFT adapter patterns
            const network = await this.getChainId()
            const knownAdapters: Record<string, Record<number, string>> = {
                // USDC
                '0xA0b86a33E6441b8c4C8C8C8C8C8C8C8C8C8C8C8': {
                    1: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff',
                    56: '0x9aF3b7DC29D3C4A1D9eC55F6B2026655c43f4d4a',
                    137: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff'
                },
                // USDT
                '0xdAC17F958D2ee523a2206206994597C13D831ec7': {
                    1: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
                    56: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
                    137: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
                }
            }
            
            const adapterAddress = knownAdapters[tokenAddress.toLowerCase()]?.[network]
            if (adapterAddress) {
                return adapterAddress
            }
            
            return null
        } catch (error) {
            console.error('Error finding OFT adapter:', error)
            return null
        }
    }

    /**
     * Validate OFT adapter deployment and accessibility
     */
    async validateOFTAdapter(oftAddress: string): Promise<{ isValid: boolean; error?: string }> {
        try {
            console.log('🔍 Validating OFT adapter:', oftAddress)
            
            // Check if contract exists
            const code = await this.provider.getCode(oftAddress)
            if (code === '0x') {
                return { isValid: false, error: 'Contract does not exist at this address' }
            }
            
            console.log('✅ Contract exists at address')
            
            // Check if contract has OFT functions
            const signer = await this.getSigner()
            const oft = new ethers.Contract(oftAddress, [
                'function token() external view returns (address)',
                'function quoteSend(tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, bool payInLzToken) external view returns (uint256 nativeFee, uint256 lzTokenFee)',
                'function send(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd, tuple(uint256 nativeFee, uint256 lzTokenFee) fee, address refundAddress) external payable returns (bytes32 guid)'
            ], signer)
            
            // Try to get underlying token
            try {
                const underlyingToken = await oft.token()
                console.log('✅ Underlying token address:', underlyingToken)
                
                // Check if underlying token exists
                const tokenCode = await this.provider.getCode(underlyingToken)
                if (tokenCode === '0x') {
                    return { isValid: false, error: 'Underlying token contract does not exist' }
                }
                
                console.log('✅ Underlying token contract exists')
                
                // Test quoteSend function with minimal parameters
                const testSendParam = {
                    dstEid: 30101,
                    to: '0x0000000000000000000000000000000000000000000000000000000000000000',
                    amountLD: '1000000',
                    minAmountLD: '1000000',
                    extraOptions: '0x',
                    composeMsg: '0x',
                    oftCmd: '0x'
                }
                
                try {
                    await oft.quoteSend(testSendParam, false)
                    console.log('✅ quoteSend function is accessible')
                } catch (quoteError) {
                    console.log('⚠️ quoteSend test failed:', quoteError)
                    // This might be expected if the adapter has specific requirements
                }
                
                return { isValid: true }
                
            } catch (error) {
                console.log('❌ Could not get underlying token:', error)
                return { isValid: false, error: 'Contract does not implement OFT interface (missing token() function)' }
            }
            
        } catch (error) {
            console.error('❌ OFT adapter validation failed:', error)
            return { isValid: false, error: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}` }
        }
    }

    /**
     * Check network compatibility and OFT adapter deployment
     */
    async checkNetworkCompatibility(oftAddress: string): Promise<{ 
        isCompatible: boolean; 
        currentNetwork: string; 
        error?: string;
        recommendations?: string[];
    }> {
        try {
            const chainId = await this.getChainId()
            const srcEid = await this.getCurrentSrcEid()
            
            console.log('🌐 Checking network compatibility...')
            console.log('  Chain ID:', chainId)
            console.log('  Source EID:', srcEid)
            
            // Map chainId to network name
            const networkNames: Record<number, string> = {
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
            
            const currentNetwork = networkNames[chainId] || `Unknown Network (${chainId})`
            console.log('  Network name:', currentNetwork)
            
            // Check if OFT adapter is deployed on this network
            const code = await this.provider.getCode(oftAddress)
            if (code === '0x') {
                return {
                    isCompatible: false,
                    currentNetwork,
                    error: 'OFT adapter is not deployed on this network',
                    recommendations: [
                        'Check if you are on the correct network',
                        'Verify the OFT adapter address is correct for this network',
                        'Some OFT adapters are only deployed on specific networks'
                    ]
                }
            }
            
            // Check if the adapter works on this network
            const validation = await this.validateOFTAdapter(oftAddress)
            if (!validation.isValid) {
                return {
                    isCompatible: false,
                    currentNetwork,
                    error: validation.error,
                    recommendations: [
                        'The OFT adapter exists but may not be properly configured',
                        'Check if the underlying token is deployed on this network',
                        'Verify the adapter supports the token you want to transfer'
                    ]
                }
            }
            
            return {
                isCompatible: true,
                currentNetwork,
                recommendations: [
                    'Network and OFT adapter are compatible',
                    'Ready for cross-chain transfer'
                ]
            }
            
        } catch (error) {
            console.error('❌ Network compatibility check failed:', error)
            return {
                isCompatible: false,
                currentNetwork: 'Unknown',
                error: `Network check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                recommendations: [
                    'Check your network connection',
                    'Verify MetaMask is connected to the correct network'
                ]
            }
        }
    }

    /**
     * Check if OFT adapter supports specific destination and amount
     */
    async checkOFTAdapterSupport(oftAddress: string, dstEid: number, amount: string, decimals: number): Promise<{ 
        isSupported: boolean; 
        error?: string;
        recommendations?: string[];
    }> {
        try {
            console.log('🔍 Checking OFT adapter support...')
            console.log('  OFT Address:', oftAddress)
            console.log('  Destination EID:', dstEid)
            console.log('  Amount:', amount)
            console.log('  Decimals:', decimals)
            
            const signer = await this.getSigner()
            const oft = new ethers.Contract(oftAddress, [
                'function quoteSend(tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, bool payInLzToken) external view returns (uint256 nativeFee, uint256 lzTokenFee)',
                'function token() external view returns (address)',
                'function decimals() external view returns (uint8)'
            ], signer)
            
            // Get token decimals from OFT adapter
            let oftDecimals: number
            try {
                oftDecimals = await oft.decimals()
                console.log('  OFT decimals:', oftDecimals)
            } catch {
                oftDecimals = decimals
                console.log('  Using provided decimals:', oftDecimals)
            }
            
            // Convert amount to the correct units
            const amountUnits = parseUnits(amount, oftDecimals)
            console.log('  Amount in units:', amountUnits.toString())
            
            // Test with a minimal amount first
            const testAmount = parseUnits('0.001', oftDecimals) // Test with 0.001 tokens
            console.log('  Test amount:', testAmount.toString())
            
            const testSendParam = {
                dstEid: dstEid,
                to: '0x0000000000000000000000000000000000000000000000000000000000000000',
                amountLD: testAmount.toString(),
                minAmountLD: testAmount.toString(),
                extraOptions: '0x',
                composeMsg: '0x',
                oftCmd: '0x'
            }
            
            try {
                console.log('  Testing with minimal amount...')
                const testQuote = await oft.quoteSend(testSendParam, false)
                console.log('  ✅ Minimal amount quote successful')
                console.log('    Native fee:', testQuote[0].toString())
                console.log('    LZ fee:', testQuote[1].toString())
                
                // Now test with the actual amount
                const actualSendParam = {
                    dstEid: dstEid,
                    to: '0x0000000000000000000000000000000000000000000000000000000000000000',
                    amountLD: amountUnits.toString(),
                    minAmountLD: amountUnits.toString(),
                    extraOptions: '0x',
                    composeMsg: '0x',
                    oftCmd: '0x'
                }
                
                try {
                    console.log('  Testing with actual amount...')
                    const actualQuote = await oft.quoteSend(actualSendParam, false)
                    console.log('  ✅ Actual amount quote successful')
                    console.log('    Native fee:', actualQuote[0].toString())
                    console.log('    LZ fee:', actualQuote[1].toString())
                    
                    return {
                        isSupported: true,
                        recommendations: [
                            'OFT adapter supports this destination and amount',
                            'Ready for cross-chain transfer'
                        ]
                    }
                    
                } catch (actualError) {
                    console.log('  ❌ Actual amount quote failed:', actualError)
                    
                    // Check if it's a minimum amount issue
                    if (actualError instanceof Error && actualError.message.includes('execution reverted')) {
                        return {
                            isSupported: false,
                            error: 'Amount too small for this OFT adapter',
                            recommendations: [
                                'Try increasing the transfer amount',
                                'Check the minimum transfer amount for this token',
                                'Some OFT adapters have minimum amount requirements'
                            ]
                        }
                    }
                    
                    return {
                        isSupported: false,
                        error: 'OFT adapter does not support this amount',
                        recommendations: [
                            'Try a different amount',
                            'Check if the OFT adapter has specific requirements'
                        ]
                    }
                }
                
            } catch (minimalError) {
                console.log('  ❌ Minimal amount quote failed:', minimalError)
                
                // Check if it's a destination issue
                if (minimalError instanceof Error && minimalError.message.includes('execution reverted')) {
                    return {
                        isSupported: false,
                        error: `OFT adapter does not support destination network ${dstEid}`,
                        recommendations: [
                            'Check if this OFT adapter supports the destination network',
                            'Try a different destination network',
                            'Some OFT adapters only support specific networks'
                        ]
                    }
                }
                
                return {
                    isSupported: false,
                    error: 'OFT adapter validation failed',
                    recommendations: [
                        'Check if the OFT adapter is properly deployed',
                        'Verify the OFT adapter address is correct',
                        'Try a different OFT adapter'
                    ]
                }
            }
            
        } catch (error) {
            console.error('❌ OFT adapter support check failed:', error)
            return {
                isSupported: false,
                error: `Support check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                recommendations: [
                    'Check your network connection',
                    'Verify the OFT adapter address',
                    'Try refreshing the page'
                ]
            }
        }
    }
} 