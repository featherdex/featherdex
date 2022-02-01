import React from 'react';
import styled from 'styled-components';
import N from 'decimal.js';
import useInterval from 'use-interval';

import { Mutex } from 'async-mutex';
import { ipcRenderer } from 'electron';

import AppContext from './contexts/AppContext';
import AssetSearch from './AssetSearch';
import CoinInput from './CoinInput'
import api from './api';

import {
	getAddressAssets, estimateSendFee, handleError, handlePromise, repeatAsync, log,
	estimateTxFee, chainSend, fundTx, signTx, sendTx, toUTXO, sendAlert, sendConfirm,
	notify
} from './util';
import {
	PROPID_BITCOIN, PROPID_COIN, SATOSHI, CHECK_BUTTON_SYMBOL, CROSS_MARK_SYMBOL,
	WARNING_SYMBOL, ACCOUNT_LABEL
} from './constants';

const C = {
	Container: styled.div`
	padding-top: 4px;
	display: flex;
	flex-flow: row;
	width: 100%;
	& > table {
		flex: 1;
	}`,
	Table: styled.table`
	width: 100%;
	padding-right: 8px;
	& td {
		box-sizing: border-box;
		height: 35px;
		font-size: 9pt;
		padding: 0;
	}
	& td:first-child, & td:nth-child(3) {
		padding-left: 6px;
		width: 60px;
		text-align: right;
	}`,
	Header: styled.th`text-align: center;`,
	Search: styled.td`padding-left: 8px !important;`,
	Address: styled.input`
	box-sizing: border-box;
	width: 100%;
	font: 10pt monospace;`,
	AssetSelect: styled.td`
	padding-left: 8px !important;
	max-width: 10em;`,
	RButtons: styled.td`
	& > * {
		display: inline-block;
		margin-right: 8px;
	}`,
};

const AssetSend = () => {
	const { assetList, getClient, getConstants } = React.useContext(AppContext);
	const [asset, setAsset] = React.useState(-1);
	const [amount, setAmount] = React.useState(new N(0));
	const [available, setAvailable] = React.useState(new N(0));
	const [fee, setFee] = React.useState(new N(0));
	const [divisible, setDivisible] = React.useState(null as boolean);
	const [address, setAddress] = React.useState("");
	const [errmsg, setErrmsg] = React.useState("");

	const assetMutex = React.useMemo(() => new Mutex(), []);
	const msgMutex = React.useMemo(() => new Mutex(), []);
	const feeMutex = React.useMemo(() => new Mutex(), []);
	const sendMutex = React.useMemo(() => new Mutex(), []);

	const assets = React.useMemo(() =>
		assetList.reduce((set, v) => set.add(v.id), new Set<number>()), [assetList]);

	const refreshAsset = () => {
		assetMutex.runExclusive(async () => {
			const API = api(getClient());

			if (!assets.has(asset)) {
				setAvailable(new N(0));
				setDivisible(null);
				return;
			}

			if (asset === PROPID_COIN) {
				const balance = await
					handlePromise(repeatAsync(API.getCoinBalance, 5)(),
						"Could not get coin balance");
				if (balance === null) return;

				setAvailable(new N(balance));
				setDivisible(true);
				return;
			}

			const assetInfo = await handlePromise(repeatAsync(API.getProperty, 5)
				(asset), `Could not get asset info for property #${asset}`);
			const balances = await handlePromise(repeatAsync(API.getWalletAssets, 5)
				(asset), `Could not query wallet balance for property #${asset}`);
			const balance = balances ?
				balances.find(v => v.propertyid === asset) : null;

			if (assetInfo === null) setDivisible(null);
			else setDivisible(assetInfo.divisible);

			if (balance === null) setAvailable(new N(0));
			else setAvailable(new N(balance.balance));
		});
	}

	React.useEffect(refreshAsset, [asset]);
	useInterval(refreshAsset, 30000);

	const getErrmsg = async () => {
		const { MIN_CHANGE } = getConstants();

		let msg = null;
		if (asset === -1) msg = "Please select an asset";
		else if (!assets.has(asset)) msg = `Asset #${asset} does not exist`;
		else if (!address || address.length === 0) msg = "Please enter an address";
		else if (amount.eq(0)) msg = "Please enter an amount greater than zero";
		else if (available && amount.gt(available))
			msg = "Amount exceeds available balance";
		else if (asset === PROPID_COIN && amount.lte(MIN_CHANGE))
			msg = `Amount must be above ${MIN_CHANGE}`;
		else if (asset === PROPID_COIN && amount.add(fee).gt(available))
			msg = "Amount with fee exceeds available balance";

		// These error messages take priority, return first
		if (msg) return msg;

		const API = api(getClient());
		const { COIN_TICKER } = getConstants();

		const validAddress = await
			handlePromise(repeatAsync(API.validateAddress, 5)(address),
				`Could not process validation for address ${address}`);
		if (validAddress === null) msg = "Could not validate address";
		else if (!validAddress.isvalid) msg = "Invalid address";

		// Priority, return first
		if (msg) return msg;

		const balance = await handlePromise(repeatAsync(API.getCoinBalance, 5)(),
			"Could not query coin balance");
		if (balance === null) msg = `Could not query ${COIN_TICKER} balance`;
		else if (fee.gt(balance))
			msg = `fee ${fee} exceeds ${COIN_TICKER} balance ${balance}`;

		return msg;
	}

	// Update error message display
	React.useEffect(() => {
		msgMutex.runExclusive(async () => setErrmsg(await getErrmsg()));
	}, [asset, assets, amount, available, address, fee]);

	// Update fee display
	React.useEffect(() => {
		feeMutex.runExclusive(async () => {
			const {
				EXODUS_ADDRESS, FEE_ADDRESS, MIN_CHANGE, COIN_SUPPLY
			} = getConstants();
			const client = getClient();
			const API = api(client);

			log().debug("entering fee estimation")

			if (asset === -1 || !assets.has(asset) || amount.eq(0) || !address
				|| address.length === 0 || amount.gt(available)) return;

			// If coin, use dummy transaction
			if (asset === PROPID_COIN) {
				if (amount.lte(MIN_CHANGE)) return;
				const bp: RawTxBlueprint =
					{ ins: [], outs: [{ [EXODUS_ADDRESS]: +amount }] };
				const pretx = await
					handlePromise(repeatAsync(API.createRawTransaction, 3)(bp),
						"Could not create raw transaction for fee estimation");
				if (pretx === null) return;

				const rawtx = await fundTx(client, pretx,
					{ changeAddress: FEE_ADDRESS }, null).catch(_ => null);
				if (rawtx === null) {
					setFee(new N(COIN_SUPPLY)); // use absurd amount
					return;
				}

				const fee = await estimateTxFee(client, rawtx);
				if (fee === null) return;

				log().debug("fee")
				log().debug(fee)

				setFee(fee);
				return;
			}

			const assetBalances = await getAddressAssets(client, asset).catch(e => {
				handleError(e, "error");
				return null as Awaited<ReturnType<typeof getAddressAssets>>;
			});
			if (assetBalances === null) return;

			let count = 0, remaining = amount;
			for (let i of assetBalances) {
				if (remaining.lte(0)) break;
				remaining = remaining.sub(i.amount);
				count++;
			}

			const sendFee = await
				estimateSendFee(getConstants(), client, count).catch(e => {
					handleError(e, "error");
					return null;
				});
			if (sendFee === null) return;

			setFee(sendFee.totalFee);
		});
	}, [asset, amount, assets]);

	const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const target = event.target;
		const v = target.value;
		const name = target.name;

		if (name === "send-address") setAddress(v);
	};

	const doSend = () => sendMutex.runExclusive(async () => {
		log().debug("enter doSend")
		// run validation again because the information may not be up to date
		{
			const msg = await getErrmsg();
			if (msg !== null) {
				sendAlert(msg);
				setErrmsg(msg);
				return;
			}
		}

		const consts = getConstants();
		const client = getClient();
		const API = api(client);

		const c = sendConfirm(`Are you sure you want to send ${amount}`
			+ ` ${asset === PROPID_COIN ? consts.COIN_TICKER : `Asset #${asset}`}`
			+ ` to ${address}?`);
		if (!c) return;

		if (asset === PROPID_COIN) {
			await handlePromise(repeatAsync(API.sendToAddress, 5)
				(address, amount), `Could not send ${amount} to ${address}`);
			return;
		}

		// Run additional validation based on fees
		const assetBalances = await getAddressAssets(client, asset).catch(e => {
			handleError(e, "error");
			return null as Awaited<ReturnType<typeof getAddressAssets>>;
		});
		if (assetBalances === null) return;

		log().debug("enter loop sends")
		let sends: { address: string, amount: N }[] = [], remaining = amount;
		for (let i of assetBalances) {
			log().debug(`remaining=${remaining} i.amount=${i.amount}`)
			if (remaining.lte(i.amount)) {
				sends.push({ address: i.address, amount: remaining });
				break;
			}
			remaining = remaining.sub(i.amount);
			sends.push({ address: i.address, amount: i.amount });
		}
		log().debug("end loop, count=${sends.length}")

		if (sends.length === 0) {
			sendAlert(`Could not find any available asset #${asset} to send`);
			return;
		}

		const sendFee = await
			estimateSendFee(consts, client, sends.length).catch(e => {
				handleError(e, "error");
				return null as Awaited<ReturnType<typeof estimateSendFee>>;
			});
		if (sendFee === null) return;

		log().debug("sendFee")
		log().debug(sendFee)

		// Fund fees transaction
		let utxo;
		{
			log().debug("enter fund fees")
			const blueprint: RawTxBlueprint =
				{ ins: [], outs: [{ [sends[0].address]: +sendFee.totalFee }] };

			const pretx = await
				handlePromise(repeatAsync(API.createRawTransaction, 5)(blueprint),
					"Could not create raw fund fees transaction (simple send)");
			if (pretx === null) return;

			log().debug("pretx")
			log().debug(pretx)

			const rawtx = await fundTx(client, pretx, { changePosition: 1 },
				"Could not fund raw transaction for fund fees (simple send)");
			if (rawtx === null) return;

			log().debug("rawtx")
			log().debug(rawtx)

			const signedtx = await signTx(client, rawtx,
				"Could not sign raw transaction for fund fees (simple send)");
			if (signedtx === null) return;

			log().debug("signedtx")
			log().debug(signedtx)

			const sendtx = await sendTx(client, signedtx,
				"Could not send raw transaction for fund fees (simple send)");
			if (sendtx === null) return;

			log().debug("sendtx")
			log().debug(sendtx)

			utxo = toUTXO(sendtx, 0, sends[0].address, sendFee.totalFee);

			log().debug("utxo")
			log().debug(utxo)
		}

		// Chain send
		{
			const chain = await chainSend(consts, client, asset,
				sends, utxo, address, sendFee.sendFee);
			if (chain === null) return;

			utxo = chain.utxo;
		}

		notify("success", `Sent asset #${asset}`,
			`Sent ${amount} asset #${asset} to address ${address},`
			+ ` fees ${sendFee.totalFee} ${consts.COIN_NAME}`);
	});

	return <C.Table>
		<thead>
			<tr><C.Header colSpan={4}>Send Asset</C.Header></tr>
		</thead>
		<tbody>
			<tr>
				<td>Asset:</td>
				<C.Search>
					<AssetSearch setAssetCallback={setAsset}
						filter={p => p.id > PROPID_BITCOIN} />
				</C.Search>
				<td>Quantity:</td>
				<td>
					<CoinInput value={amount} dispatch={setAmount}
						step={divisible ? SATOSHI : new N(1)}
						digits={divisible ? 8 : 0} />
				</td>
			</tr>
			<tr>
				<td>Recipient address:</td>
				<td style={{ paddingLeft: 8 }}>
					<C.Address type="text" name="send-address"
						onChange={handleChange} />
				</td>
				<td>Available balance:</td>
				<td>
					<input type="number" name="available"
						className="coin form-field"
						value={available.toFixed(divisible ? 8 : 0)} min={0}
						readOnly />
				</td>
			</tr>
			<tr>
				<td>
					<button onClick={doSend} style={{
						display: "inline-block",
						marginRight: "8px",
					}} disabled={errmsg !== null || divisible === null}>
						Send
					</button>
				</td>
				<td>{errmsg ? `${CROSS_MARK_SYMBOL} ${errmsg}`
					: `${CHECK_BUTTON_SYMBOL} Estimated fee: ${+fee}`}</td>
				<td></td>
				<td style={{ paddingLeft: 8 }}>
					<button onClick={() => setAmount(available)} style={{
						display: "inline-block",
						marginRight: "8px",
					}}>
						Max
					</button>
				</td>
			</tr>
		</tbody>
	</C.Table>;
};

const AssetReceive = () => {
	const {
		settings, getClient, getConstants, setSettings, saveSettings
	} = React.useContext(AppContext);

	const [address, setAddress] = React.useState<string>(null);
	const [balance, setBalance] = React.useState(new N(0));

	const setMutex = React.useMemo(() => new Mutex(), []);
	const balMutex = React.useMemo(() => new Mutex(), []);

	// Use an existing address or generate a new address
	React.useEffect(() => {
		setMutex.runExclusive(async () => {
			log().debug("Enter check receive address")
			if (address !== null || settings === null) return;

			log().debug("Checking settings")
			// First check the saved address in settings
			const savedAddress: string = settings.receiveAddress;

			log().debug("savedAddress")
			log().debug(savedAddress)

			const API = api(getClient());
			const addressInfo = await repeatAsync(API.getAddressInfo, 5)
				(savedAddress).catch(e => e.code === -1 || e.code === -5 ?
					false : null);
			if (addressInfo === null) return;

			log().debug(addressInfo)

			if (!!addressInfo && (addressInfo as AddressInfo).ismine) {
				log().debug(`has saved address ${savedAddress}`)
				setAddress(savedAddress);
				return;
			}

			const addressMap = await
				handlePromise(repeatAsync(API.listAddressGroupings, 3)(),
					"Could not list address groupings", arr =>
					arr.flat(1).reduce((map, v) => map.set(v[0], v[1]),
						new Map<string, number>()));
			if (addressMap === null) return;

			// If we have no addresses, make a new one
			if (addressMap.size === 0) {
				log().debug("making new address")
				const newAddress = await
					handlePromise(repeatAsync(API.getNewAddress, 5)(ACCOUNT_LABEL),
						"Could not generate new address");
				if (newAddress === null) return;

				log().debug(`made new address ${newAddress}`)
				setAddress(newAddress);
				return;
			}

			// Otherwise grab the address with the highest coin value
			const highAddress = [...addressMap.entries()].sort((a, b) =>
				b[1] - a[1])[0][0];
			setAddress(highAddress);

			log().debug(`used high address ${highAddress}`)
		});
	}, [settings]);

	React.useEffect(() => {
		log().debug("Entering save receive address")
		if (!!settings && !!address && address.length > 0
			&& address !== settings.receiveAddress) {
			log().debug(`saving new=${address} old=${settings.receiveAddress}`)
			setSettings({ receiveAddress: address });
			saveSettings();
		}
	}, [address, settings]);

	const refreshBalance = () => {
		balMutex.runExclusive(async () => {
			log().debug("Entering balance check")
			if (address === null || address.length === 0) return;

			const API = api(getClient());
			const utxos = await handlePromise(repeatAsync(API.listUnspent, 3)(),
				"Could not list unspent for balance check");
			if (utxos === null) return;

			log().debug("utxos")
			log().debug(utxos)

			const balance = utxos.filter(v =>
				v.address === address).reduce((acc, v) =>
					acc.add(v.amount), new N(0));
			setBalance(balance);

			log().debug("balance")
			log().debug(balance)
		});
	};

	React.useEffect(refreshBalance, [address]);

	useInterval(refreshBalance, 30000);

	const regenerate = () => setMutex.runExclusive(async () => {
		const API = api(getClient());

		log().debug("making new address (regenerate)")
		const newAddress = await
			handlePromise(repeatAsync(API.getNewAddress, 5)("featherdex"),
				"Could not generate new address");
		if (newAddress === null) return;

		log().debug(`made new address ${newAddress} (regenerate)`)
		setAddress(newAddress);

		notify("success", "Generated new receive address",
			`Generated new receive address ${newAddress}`);
	});

	return <C.Table>
		<thead><tr><C.Header colSpan={4}>Receive Asset</C.Header></tr></thead>
		<tbody>
			<tr>
				<td>Address:</td>
				<td style={{ paddingLeft: 8 }} colSpan={3}>
					<C.Address type="text" name="receive-address"
						value={address || ""} readOnly />
				</td>
			</tr>
			<tr>
				<td>{getConstants().COIN_TICKER} balance:</td>
				<td>
					<input type="number" name="balance" className="coin form-field"
						value={balance.toFixed(8)} min={0} readOnly />
				</td>
				<td>{balance.lt(0.1) ? WARNING_SYMBOL : ""}</td>
				<td style={{ paddingLeft: 8 }}>
					{balance.lt(0.1) ?
						"Low balance, refill for Omni transactions" : ""}
				</td>
			</tr>
			<tr>
				<C.RButtons colSpan={4}>
					<button disabled={!address || address.length === 0}
						onClick={() => {
							ipcRenderer.send("clipboard:copy", address);
							notify("success", "Copied address to clipboard",
								`Copied ${address} to clipboard`);
						}}>
						Copy Address to Clipboard
					</button>
					<button onClick={regenerate}>Generate new Address</button>
				</C.RButtons>
			</tr>
		</tbody>
	</C.Table>
};

const AssetTransfer = () => {
	return <C.Container><AssetSend /><AssetReceive /></C.Container>;
};

export default AssetTransfer;