const connectButton = document.getElementById('connectButton');
const getBalanceButton = document.getElementById('getBalanceButton');
const transferButton = document.getElementById('transferButton');
const statusDiv = document.getElementById('status');
const userAddressInput = document.getElementById('userAddress');
const contractAddressInput = document.getElementById('contractAddress');
const balancesDiv = document.getElementById('balances');
const recipientAddressInput = document.getElementById('recipientAddress');
const transferStatusDiv = document.getElementById('transferStatus');
const logContent = document.getElementById('logContent');

const ID_FETCH_LIMIT = 5000;
const METADATA_FETCH_TIMEOUT = 10000;

let provider;
let signer;
let userAddress;
let currentContractAddress;
let currentBalances = {}; // { idString: balanceString }

const fullLogger = createLogger({
    logToConsole: true,
    logContent: logContent,
    statusDiv: statusDiv,
});

function logMessage(message) {
    fullLogger.message(message);
}

async function connectWalletUI(logger) {
    try {
        signer = connectWeb3Wallet(logger);
        if (!signer) {
            return;
        }
        await switchToPolygon(logger);
        userAddressInput.value = userAddress;
        connectButton.textContent = t('Wallet connected');
        connectButton.disabled = true;
        getBalanceButton.disabled = false;
        window.ethereum.on('accountsChanged', handleAccountsChanged);
        window.ethereum.on('chainChanged', handleChainChanged);
    } catch (error) {
        logger.error(`${t('Connection error')}: ${error.message || error}`);
    }
}

function handleAccountsChanged(accounts) {
    if (accounts.length === 0) {
        logMessage(t('Wallet disconnected'));
        resetApp();
    }
    else {
        userAddress = accounts[0];
        logMessage(`${t('Account changed')}: ${userAddress}`);
        userAddressInput.value = userAddress;
        signer = provider.getSigner();
        resetBalancesAndTransfer();
        if (currentContractAddress) {
            getBalances();
        }
    }
}

function handleChainChanged(chainId) {
    logMessage(`${t('Network changed')}: ${chainId}`);
    provider = new ethers.providers.Web3Provider(window.ethereum);
    signer = provider.getSigner();
    if (chainId !== POLYGON_CHAIN_ID) {
        logMessage(t('Warning: Wrong network selected.'));
        statusDiv.textContent = t('Status: Wrong network connected!');
        statusDiv.style.color = 'orange';
        resetBalancesAndTransfer();
        getBalanceButton.disabled = true;
    } else {
        logMessage(t('Connected to Polygon network'));
        statusDiv.textContent = t('Status: Connected to Polygon');
        statusDiv.style.color = 'green';
        getBalanceButton.disabled = !userAddress;
        if (currentContractAddress && userAddress) {
            getBalances();
        }
    }
}
function resetApp() {
    statusDiv.textContent = t('Not connected');
    statusDiv.style.color = 'black';
    userAddressInput.value = '';
    connectButton.textContent = t('Connect Wallet');
    connectButton.disabled = false;
    getBalanceButton.disabled = true;
    transferButton.disabled = true;
    contractAddressInput.value = '';
    recipientAddressInput.value = '';
    currentContractAddress = null;
    userAddress = null;
    provider = null;
    signer = null;
    resetBalancesAndTransfer();
    logContent.textContent = '';
}

function resetBalancesAndTransfer() {
    balancesDiv.innerHTML = t('No data');
    transferStatusDiv.textContent = '';
    currentBalances = {};
    transferButton.disabled = true;
}

function resolveMetadataUri(uri, tokenId) {
    if (!uri) {
        return null;
    }

    if (uri.includes('{id}')) {
        const hexId = ethers.BigNumber.from(tokenId).toHexString().substring(2).padStart(64, '0');
        uri = uri.replace('{id}', hexId);
    }

    if (uri.startsWith('ipfs://')) {
        return `https://ipfs.io/ipfs/${uri.substring(7)}`;
    }

    return uri;
}

function resetBalancesAndTransfer() {
    balancesDiv.innerHTML = t('No data');
    transferStatusDiv.textContent = '';
    currentBalances = {};
    transferButton.disabled = true;
}

async function safeGetTokenUri(contract, tokenId) {
    try {
        const contractCode = await contract.provider.getCode(contract.address);
        if (contractCode === '0x') {
            throw new Error(t('Contract not found'));
        }

        const uri = await contract.uri(tokenId);
        return uri;
    } catch (error) {
        console.warn(`${t('Error getting URI for token')} ${tokenId}: ${error.message}`);
        return null;
    }
}

async function getBalances() {
    userAddress = userAddressInput.value;
    currentContractAddress = contractAddressInput.value.trim();
    if (!ethers.utils.isAddress(currentContractAddress)) { return; }
    if (!provider || !userAddress) { return; }

    logMessage(`${t('Requesting balances for contract')} ${currentContractAddress}...`);
    balancesDiv.innerHTML = `<i>${t('Loading balances')}...</i>`;
    getBalanceButton.disabled = true;
    resetBalancesAndTransfer();

    try {
        const contract = new ethers.Contract(currentContractAddress, erc1155Abi, provider);
        const tokensWithBalance = [];
        const limit = 500;
        const iterationCount = Math.round(ID_FETCH_LIMIT / limit);

        for (let x = 0; x <= iterationCount; x++) {
            const idsToCheck = [];
            const accounts = [];
            const rangeFrom = x * limit;
            const rangeTo = Math.min(limit * (x + 1), ID_FETCH_LIMIT);
            for (let i = rangeFrom; i <= rangeTo; i++) {
                idsToCheck.push(ethers.BigNumber.from(i));
                accounts.push(userAddress);
            }

            logMessage(`${t('Calling balanceOfBatch for IDs')} ${rangeFrom}-${rangeTo}...`);
            const balancesBigNum = await contract.balanceOfBatch(accounts, idsToCheck);
            logMessage(t('Balances received. Requesting metadata...'));

            balancesBigNum.forEach((balance, index) => {
                if (!balance.isZero()) {
                    tokensWithBalance.push({ id: idsToCheck[index], balance: balance });
                }
            });
        }

        if (tokensWithBalance.length === 0) {
            balancesDiv.innerHTML = t('No tokens with balance > 0 in range') + ` 0-${ID_FETCH_LIMIT}.`;
            logMessage(t('No tokens with balance > 0 in range') + ` 0-${ID_FETCH_LIMIT}.`);
            return;
        }

        balancesDiv.innerHTML = `<i>${t('Loading metadata')} (${tokensWithBalance.length} ${t('tokens')})...</i>`;

        const metadataPromises = tokensWithBalance.map(async (token) => {
            const tokenId = token.id;
            const balance = token.balance;
            let name = `Token ID: ${tokenId.toString()}`;
            let imageUrl = null;
            let decimals = 0;
            let metadataError = null;

            try {
                const rawUri = await safeGetTokenUri(contract, tokenId);

                if (rawUri) {
                    const resolvedUri = resolveMetadataUri(rawUri, tokenId);

                    if (resolvedUri) {
                        logMessage(`[ID: ${tokenId}] ${t('Requesting metadata from')} ${resolvedUri}`);
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), METADATA_FETCH_TIMEOUT);

                        try {
                            const response = await fetch(resolvedUri, {
                                signal: controller.signal,
                                headers: {
                                    'Accept': 'application/json',
                                }
                            });
                            clearTimeout(timeoutId);

                            if (!response.ok) {
                                throw new Error(`${t('HTTP error')} ${response.status}: ${response.statusText}`);
                            }

                            const contentType = response.headers.get('content-type');
                            if (!contentType || !contentType.includes('application/json')) {
                                throw new Error(t('Response is not JSON'));
                            }

                            const metadata = await response.json();
                            name = metadata.name || name;
                            imageUrl = metadata.image || metadata.image_url || metadata.imageUrl || null;

                            if (imageUrl && imageUrl.startsWith('ipfs://')) {
                                imageUrl = `https://ipfs.io/ipfs/${imageUrl.substring(7)}`;
                            }

                            if (metadata.decimals !== undefined && Number.isInteger(metadata.decimals) && metadata.decimals >= 0) {
                                decimals = metadata.decimals;
                                logMessage(`[ID: ${tokenId}] ${t('Decimals detected')}: ${decimals}`);
                            } else {
                                logMessage(`[ID: ${tokenId}] ${t('Decimals not found or invalid in metadata, using 0.')}`);
                            }

                            logMessage(`[ID: ${tokenId}] ${t('Metadata received')}: ${t('Name')}='${name}', Decimals=${decimals}`);

                        } catch (fetchError) {
                            clearTimeout(timeoutId);
                            metadataError = `Ошибка загрузки метаданных: ${fetchError.message}`;
                            logMessage(`[ID: ${tokenId}] Ошибка fetch: ${metadataError}`);
                        }
                    } else {
                        metadataError = 'URI невалиден после обработки';
                        logMessage(`[ID: ${tokenId}] URI невалиден после обработки.`);
                    }
                } else {
                    metadataError = 'URI недоступен (метод uri() не реализован или возвращает ошибку)';
                    logMessage(`[ID: ${tokenId}] URI метаданных недоступен.`);
                }
            } catch (error) {
                metadataError = `Ошибка контракта: ${error.message}`;
                logMessage(`[ID: ${tokenId}] Ошибка получения URI: ${metadataError}`);
            }

            return {
                id: tokenId,
                rawBalance: balance,
                name: name,
                imageUrl: imageUrl,
                decimals: decimals,
                error: metadataError
            };
        });

        const metadataResults = await Promise.allSettled(metadataPromises);

        currentBalances = {};
        const balanceList = document.createElement('ul');
        let displayedCount = 0;
        let errorCount = 0;

        metadataResults.forEach(result => {
            if (result.status === 'fulfilled') {
                const data = result.value;
                const idStr = data.id.toString();
                const rawBalanceStr = data.rawBalance.toString();
                const decimals = data.decimals;

                currentBalances[idStr] = {
                    rawBalance: rawBalanceStr,
                    decimals: decimals,
                    name: data.name
                };
                displayedCount++;

                if (data.error) {
                    errorCount++;
                }

                const listItem = document.createElement('li');

                const imageDiv = document.createElement('div');
                imageDiv.classList.add('token-image');
                if (data.imageUrl) {
                    const img = document.createElement('img');
                    img.src = data.imageUrl;
                    img.alt = data.name;
                    img.onerror = () => { imageDiv.innerHTML = t('Image load error'); };
                    imageDiv.appendChild(img);
                } else {
                    imageDiv.textContent = t('No image');
                }

                const infoDiv = document.createElement('div');
                infoDiv.classList.add('token-info');

                let formattedBalance = '';
                try {
                    formattedBalance = ethers.utils.formatUnits(data.rawBalance, decimals);
                    if (decimals === 0 && formattedBalance.endsWith('.0')) {
                        formattedBalance = formattedBalance.slice(0, -2);
                    } else if (decimals > 0 && formattedBalance.includes('.') && formattedBalance.endsWith('0')) {
                        formattedBalance = parseFloat(formattedBalance).toString();
                    }
                } catch (formatError) {
                    logMessage(`[ID: ${idStr}] ${t('Balance formatting error')}: ${formatError.message}`);
                    formattedBalance = t('Error');
                }

                infoDiv.innerHTML = `
                    <strong>${data.name}</strong>
                    <small>ID: ${idStr}</small>
                    <div class="balance-line">${t('Balance')}: <span class="balance-amount">${formattedBalance}</span></div>
                    <div class="raw-balance-line">${t('Base units')}: ${rawBalanceStr}</div>
                    ${data.error ? `<span class="metadata-error">⚠️ ${data.error}</span>` : ''}
                `;

                const transferDiv = document.createElement('div');
                transferDiv.classList.add('token-transfer');
                const amountInput = document.createElement('input');
                amountInput.type = 'number';
                amountInput.max = formattedBalance;
                amountInput.step = 'any';
                amountInput.placeholder = t('Amount');
                amountInput.dataset.tokenId = idStr;
                transferDiv.appendChild(amountInput);

                listItem.appendChild(imageDiv);
                listItem.appendChild(infoDiv);
                listItem.appendChild(transferDiv);
                balanceList.appendChild(listItem);

            } else {
                errorCount++;
                logMessage(`Критическая ошибка обработки промиса метаданных: ${result.reason}`);
            }
        });

        if (displayedCount > 0) {
            balancesDiv.innerHTML = '';
            balancesDiv.appendChild(balanceList);
            transferButton.disabled = false;

            const statusMessage = `${t('Displayed balances for')} ${displayedCount} ${t('tokens')}` +
                (errorCount > 0 ? ` (${errorCount} ${t('with metadata errors')})` : '');
            logMessage(statusMessage);

            if (errorCount > 0) {
                const warningDiv = document.createElement('div');
                warningDiv.className = 'metadata-warning';
                warningDiv.innerHTML = `
                    <p><strong>⚠️ ${t('Warning')}:</strong> ${t('Failed to get metadata for')} ${errorCount} ${t('tokens')}. 
                    ${t('This may happen due to the following reasons')}:</p>
                    <ul>
                        <li>${t('Contract does not implement uri() method for some tokens')}</li>
                        <li>${t('Metadata is not available at the specified URI')}</li>
                        <li>${t('CORS issues or network errors')}</li>
                        <li>${t('Metadata loading timeout')}</li>
                    </ul>
                    <p>${t('Tokens remain functional for transfers')}.</p>
                `;
                balancesDiv.insertBefore(warningDiv, balanceList);
            }
        } else {
            balancesDiv.innerHTML = t('Failed to get metadata for any token');
            logMessage(t('Failed to get metadata for any token'));
            transferButton.disabled = true;
        }

    } catch (error) {
        logMessage(`${t('Critical error getting balances')}: ${error.message || error}`);
        balancesDiv.innerHTML = `${t('Error getting balances')}: ${error.message || error}`;
        transferButton.disabled = true;
    } finally {
        getBalanceButton.disabled = false;
    }
}

async function checkContractSupport(contract) {
    try {
        const ERC1155_INTERFACE_ID = '0xd9b67a26';
        const ERC1155_METADATA_INTERFACE_ID = '0x0e89341c';

        const supportsERC1155 = await contract.supportsInterface(ERC1155_INTERFACE_ID);
        const supportsMetadata = await contract.supportsInterface(ERC1155_METADATA_INTERFACE_ID);

        logMessage(`${t('Contract supports ERC-1155')}: ${supportsERC1155}`);
        logMessage(`${t('Contract supports ERC-1155 Metadata')}: ${supportsMetadata}`);

        return { supportsERC1155, supportsMetadata };
    } catch (error) {
        logMessage(`${t('Failed to check interface support')}: ${error.message}`);
        return { supportsERC1155: true, supportsMetadata: false };
    }
}

async function transferTokens() {
    const recipientAddress = recipientAddressInput.value.trim();
    if (!ethers.utils.isAddress(recipientAddress)) { return; }
    if (!signer || !userAddress || !currentContractAddress) { return; }

    const idsToTransfer = [];
    const amountsToTransfer = [];
    let inputError = false;
    let conversionError = false;

    const amountInputs = balancesDiv.querySelectorAll('input[type="number"][data-token-id]');

    amountInputs.forEach(input => {
        const idStr = input.dataset.tokenId;
        const amountStr = input.value.trim();
        input.style.borderColor = '';

        if (amountStr && parseFloat(amountStr) > 0) {
            const tokenData = currentBalances[idStr];
            if (!tokenData) {
                logMessage(`${t('Transfer Error: Data not found for ID')} ${idStr} ${t('in currentBalances')}.`);
                inputError = true;
                input.style.borderColor = 'red';
                return;
            }

            const { rawBalance: rawBalanceStr, decimals } = tokenData;
            const rawBalanceBigNum = ethers.BigNumber.from(rawBalanceStr);

            try {
                const rawAmountToSend = ethers.utils.parseUnits(amountStr, decimals);

                if (rawAmountToSend.isNegative() || rawAmountToSend.isZero()) {
                    throw new Error(t("Amount must be positive."));
                }
                if (rawAmountToSend.gt(rawBalanceBigNum)) {
                    throw new Error(t('Exceeds balance') + ` (${ethers.utils.formatUnits(rawBalanceBigNum, decimals)})`);
                }

                idsToTransfer.push(idStr);
                amountsToTransfer.push(rawAmountToSend);

            } catch (e) {
                logMessage(`[ID: ${idStr}] ${t('Input/validation error')}: ${e.message} (${t('Entered')}: "${amountStr}")`);
                input.style.borderColor = 'red';
                inputError = true;
                if (e.message.includes('underflow') || e.message.includes('invalid decimal value')) {
                    conversionError = true;
                }
            }
        } else if (amountStr && parseFloat(amountStr) <= 0) {
            input.style.borderColor = 'red';
            logMessage(`[ID: ${idStr}] ${t('Amount must be positive')}.`);
            inputError = true;
        }
    });

    if (inputError) {
        let alertMessage = t('Please fix the amount errors (marked in red).');
        if (conversionError) {
            alertMessage += '\n' + t('Make sure decimal places do not exceed token limit.');
        }
        alert(alertMessage);
        return;
    }

    if (idsToTransfer.length === 0) {
        logMessage(t('No tokens to transfer'));
        alert(t('Please specify amount > 0 for at least one token'));
        return;
    }

    logMessage(`${t('Preparing to transfer')} ${idsToTransfer.length} ${t('types of tokens to address')} ${recipientAddress}...`);
    logMessage(`IDs: [${idsToTransfer.join(', ')}]`);
    logMessage(`${t('Raw Amounts')}: [${amountsToTransfer.map(a => a.toString()).join(', ')}]`);
    transferButton.disabled = true;
    transferStatusDiv.textContent = t('Confirm transaction in MetaMask');

    try {
        const contract = new ethers.Contract(currentContractAddress, erc1155Abi, signer);
        const tx = await contract.safeBatchTransferFrom(
            userAddress, recipientAddress, idsToTransfer, amountsToTransfer, '0x'
        );
        logMessage(`${t('Transaction sent')}! ${t('Hash')}: ${tx.hash}`);
        transferStatusDiv.textContent = `${t('Transaction sent')}! ${t('Waiting for confirmation')}...`;
        const receipt = await tx.wait();
        logMessage(`${t('Transaction confirmed')}! ${t('Block')}: ${receipt.blockNumber}`);
        transferStatusDiv.innerHTML = `${t('Success')}! <a href="${POLYGON_EXPLORER}tx/${tx.hash}" target="_blank">PolygonScan</a>`;
        amountInputs.forEach(input => input.value = '');
        logMessage(t('Updating balances after transfer'));
        await getBalances();

    } catch (error) {
        logMessage(`${t('Transfer error')}: ${error.message || error}`);
        transferStatusDiv.textContent = `${t('Transfer error')}: ${error.message || error}`;
        transferButton.disabled = Object.keys(currentBalances).length === 0;
    }
}

window.addEventListener('load', () => {
    const logger = fullLogger;
    logger.message(t('The page is loaded. Waiting for wallet connection.'));
    connectButton.addEventListener('click', () => { connectWalletUI(logger); });
    getBalanceButton.addEventListener('click', getBalances);
    transferButton.addEventListener('click', transferTokens);
});
