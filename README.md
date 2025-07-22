# LZSent

A simple web application for cross-chain token transfers using LayerZero protocol.

## Features

- **Cross-chain transfers** - Send tokens between different blockchains
- **OFT adapter support** - Works with LayerZero OFT adapters
- **MetaMask integration** - Easy wallet connection and transaction signing
- **Real-time debugging** - Comprehensive logging and error analysis
- **Transaction tracking** - View transactions on LayerZero Scan

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- MetaMask wallet extension
- Some ETH for gas fees
- Tokens to transfer

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd lzsent
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and navigate to `http://localhost:5173`

## Usage

1. **Connect Wallet**: Click "Connect Wallet" to connect your MetaMask
2. **Enter OFT Address**: Use the dropdown or enter the OFT adapter address for your token
3. **Set Destination**: Choose the destination network (Ethereum, BSC, Polygon, etc.)
4. **Enter Details**: Fill in the recipient address and amount
5. **Get Quote**: Click "Get Quote" to see transfer fees
6. **Send Tokens**: Click "Send Tokens" to initiate the transfer
7. **Approve**: Approve the token spending in MetaMask (if needed)
8. **Confirm Transfer**: Confirm the transfer transaction in MetaMask
9. **Track**: View your transaction on LayerZero Scan

## Supported Networks

- Ethereum Mainnet
- BSC Mainnet
- Polygon Mainnet
- Avalanche Mainnet
- Arbitrum One
- Optimism
- Fantom

## Common OFT Adapters

- **USDC**: `0x176211869cA2b568f2A7D4EE941E073a821EE1ff`
- **USDT**: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`

## Development

### Project Structure

```
src/
├── components/          # React components
│   ├── ConnectionStatus.tsx
│   ├── TransferForm.tsx
│   └── TransactionResult.tsx
├── hooks/              # Custom React hooks
│   └── useOFTClient.ts
├── lib/                # Core library
│   ├── oft-client.ts   # OFT client implementation
│   ├── types.ts        # TypeScript types
│   └── utils.ts        # Utility functions
└── App.tsx             # Main application component
```

### Key Technologies

- **React** - Frontend framework
- **TypeScript** - Type safety
- **Ethers.js** - Ethereum interaction
- **LayerZero** - Cross-chain protocol
- **Vite** - Build tool

## Troubleshooting

### Common Issues

1. **"Transaction reverted"** - Check token balance and allowance
2. **"No MetaMask popup"** - Ensure MetaMask is connected and unlocked
3. **"Invalid OFT address"** - Verify the OFT adapter address is correct
4. **"Insufficient funds"** - Add more ETH for gas fees

### Debug Features

- Use the "Check OFT" button to validate OFT adapters
- View debug information in the browser console
- Check the debug panel for detailed logs

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Disclaimer

This software is provided "as is" without warranty. Use at your own risk. Always verify transactions before confirming them in your wallet.

## Author

Roberto Santacroce Martins - github.com/rsantacroce