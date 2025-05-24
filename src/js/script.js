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

const POLYGON_CHAIN_ID = '0x89'; // 137 в hex
const POLYGON_RPC_URL = 'https://polygon-rpc.com/';
const POLYGON_EXPLORER = 'https://polygonscan.com/';
const ID_FETCH_LIMIT = 5000;
const METADATA_FETCH_TIMEOUT = 10000;

let provider;
let signer;
let userAddress;
let currentContractAddress;
let currentBalances = {}; // { idString: balanceString }

const erc1155Abi = [
    "function balanceOfBatch(address[] memory accounts, uint256[] memory ids) public view returns (uint256[] memory)",
    "function safeBatchTransferFrom(address from, address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data) public",
    "function uri(uint256 _id) public view returns (string memory)"
];

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
        logger.message('Статус: Подключен к Polygon');
        userAddressInput.value = userAddress;
        connectButton.textContent = 'Кошелек подключен';
        connectButton.disabled = true;
        getBalanceButton.disabled = false;
        window.ethereum.on('accountsChanged', handleAccountsChanged);
        window.ethereum.on('chainChanged', handleChainChanged);
    } catch (error) {
        logger.error(`Ошибка подключения: ${error.message || error}`);
    }
}

async function switchToPolygon(logger) {
    logger.debug('Проверка сети...');
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    if (chainId !== POLYGON_CHAIN_ID) {
        logger.message(`Требуется переключение на Polygon (${POLYGON_CHAIN_ID})`);
        try {
            await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: POLYGON_CHAIN_ID }], });
            logger.message('Успешно переключено к Polygon.');
        } catch (switchError) {
            if (switchError.code === 4902) {
                logger.debug('Сеть Polygon не найдена, попытка добавить...');
                try {
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [{ chainId: POLYGON_CHAIN_ID, chainName: 'Polygon Mainnet', rpcUrls: [POLYGON_RPC_URL], nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18, }, blockExplorerUrls: [POLYGON_EXPLORER], }],
                    });
                    logger.debug('Сеть Polygon добавлена. Повторная попытка переключения...');
                    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: POLYGON_CHAIN_ID }], });
                    logger.debug('Успешно переключено на Polygon.');
                    statusDiv.textContent = 'Статус: Подключен к Polygon';
                } catch (addError) {
                    logger.error(`Ошибка добавления/переключения сети Polygon: ${addError.message || addError}`);
                    throw addError;
                }
            } else {
                logger.error(`Ошибка переключения сети: ${switchError.message || switchError}`);
                throw switchError;
            }
        }
    } else {
        logger.debug('Уже подключены к сети Polygon.');
    }
}

function handleAccountsChanged(accounts) {
    if (accounts.length === 0) { logMessage('Кошелек отключен.'); resetApp(); }
    else {
        userAddress = accounts[0]; logMessage(`Аккаунт изменен: ${userAddress}`);
        userAddressInput.value = userAddress;
        signer = provider.getSigner(); resetBalancesAndTransfer();
        if (currentContractAddress) { getBalances(); }
    }
}
function handleChainChanged(chainId) {
    logMessage(`Сеть изменена: ${chainId}`);
    provider = new ethers.providers.Web3Provider(window.ethereum);
    signer = provider.getSigner();
    if (chainId !== POLYGON_CHAIN_ID) {
        logMessage('Предупреждение: Выбрана неверная сеть.'); statusDiv.textContent = 'Статус: Подключена неверная сеть!'; statusDiv.style.color = 'orange';
        resetBalancesAndTransfer(); getBalanceButton.disabled = true;
    } else {
        logMessage('Подключено к сети Polygon.'); statusDiv.textContent = 'Статус: Подключен к Polygon'; statusDiv.style.color = 'green';
        getBalanceButton.disabled = !userAddress;
        if (currentContractAddress && userAddress) { getBalances(); }
    }
}
function resetApp() {
    statusDiv.textContent = 'Статус: Не подключен'; statusDiv.style.color = 'black';
    userAddressInput.value = '';
    connectButton.textContent = 'Подключить MetaMask'; connectButton.disabled = false;
    getBalanceButton.disabled = true; transferButton.disabled = true;
    contractAddressInput.value = ''; recipientAddressInput.value = '';
    currentContractAddress = null; userAddress = null; provider = null; signer = null;
    resetBalancesAndTransfer(); logContent.textContent = '';
}

function resetBalancesAndTransfer() {
    balancesDiv.innerHTML = 'Нет данных';
    transferStatusDiv.textContent = '';
    currentBalances = {};
    transferButton.disabled = true;
}

function resolveMetadataUri(uri, tokenId) {
    if (!uri) return null;

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
    balancesDiv.innerHTML = 'Нет данных';
    transferStatusDiv.textContent = '';
    currentBalances = {};
    transferButton.disabled = true;
}

// Функция для безопасного получения URI с обработкой ошибок
async function safeGetTokenUri(contract, tokenId) {
    try {
        // Проверяем, поддерживает ли контракт метод uri
        const contractCode = await contract.provider.getCode(contract.address);
        if (contractCode === '0x') {
            throw new Error('Контракт не найден');
        }

        // Пытаемся вызвать uri() с обработкой исключений
        const uri = await contract.uri(tokenId);
        return uri;
    } catch (error) {
        // Логируем ошибку для отладки
        console.warn(`Ошибка получения URI для токена ${tokenId}: ${error.message}`);
        
        // Возвращаем null, чтобы обработать отсутствие метаданных
        return null;
    }
}

// Улучшенная функция получения балансов с лучшей обработкой ошибок
async function getBalances() {
    userAddress = userAddressInput.value;
    currentContractAddress = contractAddressInput.value.trim();
    if (!ethers.utils.isAddress(currentContractAddress)) { return; }
    if (!provider || !userAddress) { return; }

    logMessage(`Запрос балансов для контракта ${currentContractAddress}...`);
    balancesDiv.innerHTML = '<i>Загрузка балансов...</i>';
    getBalanceButton.disabled = true;
    resetBalancesAndTransfer();

    try {
        const contract = new ethers.Contract(currentContractAddress, erc1155Abi, provider);
        const tokensWithBalance = [];
        const limit = 500;
        const iterationCount = Math.round(ID_FETCH_LIMIT / limit);

        // Получение балансов (этот код остается без изменений)
        for (let x = 0; x <= iterationCount; x++) {
            const idsToCheck = [];
            const accounts = [];
            const rangeFrom = x * limit;
            const rangeTo = Math.min(limit * (x + 1), ID_FETCH_LIMIT);
            for (let i = rangeFrom; i <= rangeTo; i++) {
                idsToCheck.push(ethers.BigNumber.from(i));
                accounts.push(userAddress);
            }

            logMessage(`Вызов balanceOfBatch для ID ${rangeFrom}-${rangeTo}...`);
            const balancesBigNum = await contract.balanceOfBatch(accounts, idsToCheck);
            logMessage('Балансы получены. Запрос метаданных...');

            balancesBigNum.forEach((balance, index) => {
                if (!balance.isZero()) {
                    tokensWithBalance.push({ id: idsToCheck[index], balance: balance });
                }
            });
        }

        if (tokensWithBalance.length === 0) {
            balancesDiv.innerHTML = `Нет токенов с балансом > 0 в диапазоне ID 0-${ID_FETCH_LIMIT}.`;
            logMessage(`Нет токенов с балансом > 0 в диапазоне ID 0-${ID_FETCH_LIMIT}.`);
            return;
        }

        balancesDiv.innerHTML = `<i>Загрузка метаданных (${tokensWithBalance.length} токенов)...</i>`;

        // Улучшенная обработка метаданных
        const metadataPromises = tokensWithBalance.map(async (token) => {
            const tokenId = token.id;
            const balance = token.balance;
            let name = `Token ID: ${tokenId.toString()}`;
            let imageUrl = null;
            let decimals = 0;
            let metadataError = null;

            try {
                // Используем безопасную функцию получения URI
                const rawUri = await safeGetTokenUri(contract, tokenId);
                
                if (rawUri) {
                    const resolvedUri = resolveMetadataUri(rawUri, tokenId);

                    if (resolvedUri) {
                        logMessage(`[ID: ${tokenId}] Запрос метаданных с ${resolvedUri}`);
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
                                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                            }

                            const contentType = response.headers.get('content-type');
                            if (!contentType || !contentType.includes('application/json')) {
                                throw new Error('Ответ не является JSON');
                            }

                            const metadata = await response.json();
                            name = metadata.name || name;
                            imageUrl = metadata.image || metadata.image_url || metadata.imageUrl || null;
                            
                            if (imageUrl && imageUrl.startsWith('ipfs://')) {
                                imageUrl = `https://ipfs.io/ipfs/${imageUrl.substring(7)}`;
                            }

                            if (metadata.decimals !== undefined && Number.isInteger(metadata.decimals) && metadata.decimals >= 0) {
                                decimals = metadata.decimals;
                                logMessage(`[ID: ${tokenId}] Обнаружены decimals: ${decimals}`);
                            } else {
                                logMessage(`[ID: ${tokenId}] Decimals не найдены или некорректны в метаданных, используется 0.`);
                            }

                            logMessage(`[ID: ${tokenId}] Метаданные получены: Имя='${name}', Decimals=${decimals}`);

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

        // Обрабатываем все промисы, даже если некоторые падают
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
                    img.onerror = () => { imageDiv.innerHTML = '[Ошибка загр.]'; };
                    imageDiv.appendChild(img);
                } else { 
                    imageDiv.textContent = '[Нет изобр.]'; 
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
                    logMessage(`[ID: ${idStr}] Ошибка форматирования баланса: ${formatError.message}`);
                    formattedBalance = 'Ошибка!';
                }

                infoDiv.innerHTML = `
                    <strong>${data.name}</strong>
                    <small>ID: ${idStr}</small>
                    <div class="balance-line">Баланс: <span class="balance-amount">${formattedBalance}</span></div>
                    <div class="raw-balance-line">Базовых единиц: ${rawBalanceStr}</div>
                    ${data.error ? `<span class="metadata-error">⚠️ ${data.error}</span>` : ''}
                `;

                const transferDiv = document.createElement('div');
                transferDiv.classList.add('token-transfer');
                const amountInput = document.createElement('input');
                amountInput.type = 'number';
                amountInput.max = formattedBalance;
                amountInput.step = 'any';
                amountInput.placeholder = 'Кол-во';
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
            
            const statusMessage = `Отображены балансы для ${displayedCount} токенов` + 
                                (errorCount > 0 ? ` (${errorCount} с ошибками метаданных)` : '');
            logMessage(statusMessage);
            
            // Добавляем информационное сообщение если есть ошибки
            if (errorCount > 0) {
                const warningDiv = document.createElement('div');
                warningDiv.className = 'metadata-warning';
                warningDiv.innerHTML = `
                    <p><strong>⚠️ Внимание:</strong> Для ${errorCount} токенов не удалось получить метаданные. 
                    Это может происходить по следующим причинам:</p>
                    <ul>
                        <li>Контракт не реализует метод uri() для некоторых токенов</li>
                        <li>Метаданные недоступны по указанному URI</li>
                        <li>Проблемы с CORS или сетевые ошибки</li>
                        <li>Таймаут загрузки метаданных</li>
                    </ul>
                    <p>Токены остаются функциональными для переводов.</p>
                `;
                balancesDiv.insertBefore(warningDiv, balanceList);
            }
        } else {
            balancesDiv.innerHTML = 'Не удалось получить метаданные ни для одного токена.';
            logMessage('Не удалось получить метаданные ни для одного токена.');
            transferButton.disabled = true;
        }

    } catch (error) {
        logMessage(`Критическая ошибка при получении балансов: ${error.message || error}`);
        balancesDiv.innerHTML = `Ошибка получения балансов: ${error.message || error}`;
        transferButton.disabled = true;
    } finally {
        getBalanceButton.disabled = false;
    }
}

// Дополнительная функция для проверки поддержки интерфейсов контрактом
async function checkContractSupport(contract) {
    try {
        // ERC-165 interface detection
        const ERC1155_INTERFACE_ID = '0xd9b67a26'; // ERC-1155
        const ERC1155_METADATA_INTERFACE_ID = '0x0e89341c'; // ERC-1155 Metadata Extension
        
        const supportsERC1155 = await contract.supportsInterface(ERC1155_INTERFACE_ID);
        const supportsMetadata = await contract.supportsInterface(ERC1155_METADATA_INTERFACE_ID);
        
        logMessage(`Контракт поддерживает ERC-1155: ${supportsERC1155}`);
        logMessage(`Контракт поддерживает ERC-1155 Metadata: ${supportsMetadata}`);
        
        return { supportsERC1155, supportsMetadata };
    } catch (error) {
        logMessage(`Не удалось проверить поддержку интерфейсов: ${error.message}`);
        return { supportsERC1155: true, supportsMetadata: false }; // предполагаем базовую поддержку
    }
}

async function transferTokens() {
    const recipientAddress = recipientAddressInput.value.trim();
    if (!ethers.utils.isAddress(recipientAddress)) { /*...*/ return; }
    if (!signer || !userAddress || !currentContractAddress) { /*...*/ return; }

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
                logMessage(`[Transfer Error] Не найдены данные для ID ${idStr} в currentBalances.`);
                inputError = true;
                input.style.borderColor = 'red';
                return;
            }

            const { rawBalance: rawBalanceStr, decimals } = tokenData;
            const rawBalanceBigNum = ethers.BigNumber.from(rawBalanceStr);

            try {
                const rawAmountToSend = ethers.utils.parseUnits(amountStr, decimals);

                if (rawAmountToSend.isNegative() || rawAmountToSend.isZero()) {
                    throw new Error("Количество должно быть положительным.");
                }
                if (rawAmountToSend.gt(rawBalanceBigNum)) {
                    throw new Error(`Превышает баланс (${ethers.utils.formatUnits(rawBalanceBigNum, decimals)})`);
                }

                idsToTransfer.push(idStr);
                amountsToTransfer.push(rawAmountToSend);

            } catch (e) {
                logMessage(`[ID: ${idStr}] Ошибка ввода/валидации: ${e.message} (Введено: "${amountStr}")`);
                input.style.borderColor = 'red';
                inputError = true;
                if (e.message.includes('underflow') || e.message.includes('invalid decimal value')) {
                    conversionError = true;
                }
            }
        } else if (amountStr && parseFloat(amountStr) <= 0) {
            input.style.borderColor = 'red';
            logMessage(`[ID: ${idStr}] Количество должно быть положительным.`);
            inputError = true;
        }
    });

    if (inputError) {
        let alertMessage = 'Пожалуйста, исправьте ошибки в полях количества (отмечены красным).';
        if (conversionError) {
            alertMessage += '\nУбедитесь, что количество десятичных знаков не превышает допустимое для токена.';
        }
        alert(alertMessage);
        return;
    }

    if (idsToTransfer.length === 0) {
        logMessage('Нет токенов для перевода.');
        alert('Пожалуйста, укажите количество > 0 хотя бы для одного токена.');
        return;
    }

    logMessage(`Подготовка к переводу ${idsToTransfer.length} типов токенов на адрес ${recipientAddress}...`);
    logMessage(`IDs: [${idsToTransfer.join(', ')}]`);
    logMessage(`Raw Amounts: [${amountsToTransfer.map(a => a.toString()).join(', ')}]`);
    transferButton.disabled = true;
    transferStatusDiv.textContent = 'Подтвердите транзакцию в MetaMask...';

    try {
        const contract = new ethers.Contract(currentContractAddress, erc1155Abi, signer);
        const tx = await contract.safeBatchTransferFrom(
            userAddress, recipientAddress, idsToTransfer, amountsToTransfer, '0x'
        );
        logMessage(`Транзакция отправлена! Хэш: ${tx.hash}`);
        transferStatusDiv.textContent = `Транзакция отправлена! Ожидание подтверждения...`;
        const receipt = await tx.wait();
        logMessage(`Транзакция подтверждена! Блок: ${receipt.blockNumber}`);
        transferStatusDiv.innerHTML = `Успешно! <a href="${POLYGON_EXPLORER}tx/${tx.hash}" target="_blank">PolygonScan</a>`;
        amountInputs.forEach(input => input.value = ''); // Очистка инпутов
        logMessage('Обновление балансов после перевода...');
        await getBalances();

    } catch (error) {
        logMessage(`Ошибка перевода: ${error.message || error}`);
        transferStatusDiv.textContent = `Ошибка перевода: ${error.message || error}`;
        transferButton.disabled = Object.keys(currentBalances).length === 0;
    }
}

window.addEventListener('load', () => {
    const logger = fullLogger;
    logger.message(t('The page is loaded. Waiting for wallet connection.'));
    connectButton.addEventListener('click', () => { connectWalletUI(logger);});
    getBalanceButton.addEventListener('click', getBalances);
    transferButton.addEventListener('click', transferTokens);
});
