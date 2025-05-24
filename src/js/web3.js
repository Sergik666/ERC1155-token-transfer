const erc1155Abi = [
    "function balanceOfBatch(address[] memory accounts, uint256[] memory ids) public view returns (uint256[] memory)",
    "function safeBatchTransferFrom(address from, address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data) public",
    "function uri(uint256 _id) public view returns (string memory)"
];

async function connectWeb3Wallet(logger) {
    logger.debug(t('Attempting to connect wallet...'));

    if (typeof window.ethereum === 'undefined') {
        logger.error(t('Error: Web3 wallet is not installed!'));
        return null;
    }

    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        userAddress = accounts[0];
        logger.debug(`${t('Wallet connected')}: ${userAddress}`);
        provider = new ethers.providers.Web3Provider(window.ethereum);
        return provider.getSigner();
    } catch (error) {
        logger.error(`${t('Connection error')}: ${error.message || error}`);
        return null;
    }
}

const POLYGON_CHAIN_ID = '0x89'; // 137 в hex
const POLYGON_RPC_URL = 'https://polygon-rpc.com/';
const POLYGON_EXPLORER = 'https://polygonscan.com/';

async function switchToPolygon(logger) {
    await switchToBlockchain(
        logger,
        POLYGON_CHAIN_ID,
        'Polygon Mainnet',
        [POLYGON_RPC_URL],
        {
            name: 'MATIC',
            symbol: 'MATIC',
            decimals: 18,
        },
        [POLYGON_EXPLORER]
    );
}

async function switchToBlockchain(logger, chainId, chainName, rpcUrls, nativeCurrency, blockExplorerUrls) {
    logger.debug(t('Network check...'));
    const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
    if (currentChainId !== chainId) {
        logger.message(`${t('Requires switching to')} ${chainName} (${chainId})`);
        try {
            await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainId }], });
            logger.message(`${t('Successfully switched to')} ${chainName}.`);
        } catch (switchError) {
            if (switchError.code === 4902) {
                logger.debug(`${t('Network')} ${chainName} ${t('not found, attempt to add...')}`);
                try {
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: chainId,
                            chainName: chainName,
                            rpcUrls: rpcUrls,
                            nativeCurrency: nativeCurrency,
                            blockExplorerUrls: blockExplorerUrls,
                        }],
                    });
                    logger.debug(`${t('Network')} ${chainName} ${t('added. Repeated attempt to switch....')}`);
                    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainId }], });
                    logger.message(`${t('Successfully switched to')} ${chainName}.`);
                } catch (addError) {
                    logger.error(`${t('Error adding/switching network')} ${chainName}: ${addError.message || addError}`);
                    throw addError;
                }
            } else {
                logger.error(`${t('Network switching error')}: ${switchError.message || switchError}`);
                throw switchError;
            }
        }
    } else {
        logger.debug(`${t('Already connected to the network')} ${chainName}.`);
    }
    logger.message(`${t('Connected to')} ${chainName}`);
}
