import React from 'react';
import styled from 'styled-components';
import N from 'decimal.js';

import { Mutex } from 'async-mutex';

import AppContext from '../contexts/AppContext';
import AssetSearch from './AssetSearch';
import CoinInput from './CoinInput'
import api from '../api';

import {
	estimateIssuerFee, estimateGrantFee, handleError, handlePromise, dsum,
	repeatAsync, log, estimateCreateFee, estimateNFTFee, estimateRevokeFee,
	fundAddress, notify, signTx, sendTx, waitForTx, sendAlert, sendConfirm,
	createRawCreate, createRawIssuer, createRawSetNFT, createRawGrant,
	createRawRevoke
} from '../util';
import {
	PROPID_COIN, SATOSHI, SYMBOL_CHECK_BUTTON, SYMBOL_CROSS_MARK, TYPE_DIVISIBLE,
	TYPE_INDIVISIBLE, TYPE_NFT, ECOSYSTEM_TEST, ECOSYSTEM_MAIN, ACCOUNT_LABEL,
	API_RETRIES, API_RETRIES_LARGE
} from '../constants';

const C = {
	Container: styled.div`
	padding-top: 4px;
	display: flex;
	flex-flow: row;
	width: 100%;
	& > table:first-child {
		flex: 1 0 570px;
	}`,
	Table: styled.table`
	width: 100%;
	padding-right: 8px;
	& td {
		box-sizing: border-box;
		height: 30px;
		font-size: 9pt;
		padding: 0;
	}
	& td:first-child, & td:nth-child(3) {
		padding-left: 6px;
		width: 70px;
		text-align: right;
	}`,
	Header: styled.th`text-align: center;`,
	Asset: styled.td`
	min-width: 120px;
	& > * {
		margin-left: 8px;
	}`,
	Address: styled.input`
	box-sizing: border-box;
	margin-left: 8px;
	min-width: 20em;
	font: 10pt monospace;`,
	RangeNumber: styled.input`
	margin-left: 8px;
	box-sizing: border-box;
	max-width: 6em;
	font: 10pt monospace;`
};

type CreateState = {
	name: string,
	assetType: "managed" | "fixed" | "nft",
	pre: number,
	errmsg: string,
	amount: N,
	isDivisible: boolean,
	isTest: boolean,
	hasPre: boolean,
	category: string,
	subcategory: string,
	url: string,
	data: string,
	fee: N,
};

type CreateAction = {
	type: "set_name" | "set_asset_type" | "set_pre" | "set_errmsg" | "set_amount"
	| "set_divisible" | "set_test" | "set_has_pre" | "set_category"
	| "set_subcategory" | "set_url" | "set_data" | "set_fee",
	payload?: any,
};

const reducerCreate = (state: CreateState, action: CreateAction) => {
	const payload = action.payload;
	switch (action.type) {
		case "set_name":
			return { ...state, name: payload as CreateState["name"] };
		case "set_asset_type":
			const assetType = payload as CreateState["assetType"];
			return {
				...state, assetType,
				...assetType === "nft" ? { isDivisible: false } : {},
			};
		case "set_pre":
			return { ...state, pre: payload as CreateState["pre"] };
		case "set_errmsg":
			return { ...state, errmsg: payload as CreateState["errmsg"] };
		case "set_amount":
			return { ...state, amount: payload as CreateState["amount"] };
		case "set_divisible":
			return { ...state, isDivisible: payload as CreateState["isDivisible"] };
		case "set_test":
			return { ...state, isTest: payload as CreateState["isTest"] };
		case "set_has_pre":
			return {
				...state, hasPre: payload as CreateState["hasPre"],
				...!payload ? { pre: -1 } : {},
			};
		case "set_category":
			return { ...state, category: payload as CreateState["category"] };
		case "set_subcategory":
			return { ...state, subcategory: payload as CreateState["subcategory"] };
		case "set_url":
			return { ...state, url: payload as CreateState["url"] };
		case "set_data":
			return { ...state, data: payload as CreateState["data"] };
		case "set_fee":
			return { ...state, fee: payload as CreateState["fee"] };
		default:
			throw new Error("reducerCreate called with invalid action type "
				+ action.type);
	}
};

const initCreateState: CreateState = {
	name: "",
	assetType: "managed",
	pre: -1,
	errmsg: undefined,
	amount: new N(0),
	isDivisible: true,
	isTest: false,
	hasPre: false,
	category: "",
	subcategory: "",
	url: "",
	data: "",
	fee: new N(0),
};

const AssetCreate = () => {
	const { consts, getClient, refreshAssets } = React.useContext(AppContext);

	const [state, dispatch] = React.useReducer(reducerCreate, initCreateState);

	const cDispatch = (type: CreateAction["type"]) => (payload: any) =>
		dispatch({ type, payload });

	const msgMutex = React.useMemo(() => new Mutex(), []);
	const createMutex = React.useMemo(() => new Mutex(), []);
	const feeMutex = React.useMemo(() => new Mutex(), []);

	const getErrmsg = () => {
		const client = getClient();
		if (client === null || consts === null) return "Client not initialized";

		if (state.name.length === 0) return "Name required";
		if (state.assetType === "fixed") {
			if (state.amount.lte(0)) return "Amount must be greater than zero";
			if (!state.isDivisible && !state.amount.isInteger())
				return "Amount must be whole number";
		}
		if (state.hasPre && state.pre <= 0)
			return "Please enter predecessor token";
		if (state.assetType === "nft" && state.isDivisible)
			return "NFTs cannot be divisible";
		return null;
	};

	React.useEffect(() => {
		msgMutex.runExclusive(() => cDispatch("set_errmsg")(getErrmsg()));
	}, [state.name, state.assetType, state.pre, state.hasPre, state.isDivisible,
	state.amount, consts]);

	const getFee = async () => {
		const client = getClient();
		if (state.errmsg !== null || client === null || consts === null)
			return { createFee: new N(0), totalFee: new N(0) };

		return await estimateCreateFee(consts, client, state.assetType, state.name,
			state.category, state.subcategory, state.url, state.data);
	}

	React.useEffect(() => {
		feeMutex.runExclusive(async () => cDispatch("set_fee")
			(await getFee().then(fee => fee.totalFee, _ => new N(0))));
	}, [state.assetType, state.name, state.category, state.subcategory, state.url,
	state.data, state.amount, state.errmsg, consts]);

	const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const target = event.target;
		const v = target.type === "checkbox" ? target.checked : target.value;
		const name = target.name;

		switch (name) {
			case "name": cDispatch("set_name")(v);
				break;
			case "divisible": cDispatch("set_divisible")(v as boolean);
				break;
			case "test": cDispatch("set_test")(v as boolean);
				break;
			case "haspre": cDispatch("set_has_pre")(v as boolean);
				break;
			case "category": cDispatch("set_category")(v);
				break;
			case "subcategory": cDispatch("set_subcategory")(v);
				break;
			case "url": cDispatch("set_url")(v);
				break;
			case "data": cDispatch("set_data")(v);
				break;
			default:
		}
	}

	const handleChangeSel = (event: React.ChangeEvent<HTMLSelectElement>) => {
		const target = event.target;
		const value = target.value;
		const name = target.name;

		if (name === "assettype") cDispatch("set_asset_type")(value);
	};

	const doCreate = () => createMutex.runExclusive(async () => {
		// Need to validate again
		{
			const msg = getErrmsg();
			if (msg !== null) {
				sendAlert(msg);
				cDispatch("set_errmsg")(msg);
				return;
			}

			let category;
			if (state.category.length > 0) category = state.category;
			if (state.subcategory.length > 0)
				category = (category ?? "") + ` > ${state.subcategory}`;
		}

		const assetInfo =
			` ${state.name};${state.hasPre ? ` parent: Asset #${state.pre};` : ""}`
			+ ` type: ${state.assetType}; divisible: ${state.isDivisible};`
			+ ` test token: ${state.isTest}; category: ${state.category ?? "none"};`
			+ ` url: ${state.url} additional data: ${state.data}`;

		{
			const c = sendConfirm("Are you sure you want to create this asset?"
				+ assetInfo);
			if (!c) return;
		}

		const client = getClient();
		const API = api(client);

		const tokenType = state.assetType === "nft" ? TYPE_NFT
			: (state.isDivisible ? TYPE_DIVISIBLE : TYPE_INDIVISIBLE);
		const fee = await getFee().catch(e => {
			handleError(e, "error");
			return null as Awaited<ReturnType<typeof estimateCreateFee>>;
		});
		if (fee === null) return;

		const utxo = await fundAddress(client, fee.totalFee);
		if (utxo === null) return;

		const rawtx = await createRawCreate(consts, client, state.assetType,
			state.isTest ? ECOSYSTEM_TEST : ECOSYSTEM_MAIN, tokenType, state.pre,
			state.name, state.category, state.subcategory, state.url, state.data,
			utxo, fee.createFee, state.assetType === "fixed" ?
			state.amount : undefined);

		const signedtx = await signTx(client, rawtx,
			"Could not sign raw create transaction");
		if (signedtx === null) return;

		const sendtx = await sendTx(client, signedtx,
			"Could not send create transaction");
		if (sendtx === null) return;

		notify("success", "Created new asset", assetInfo);

		waitForTx(client, sendtx).then(async _ => {
			const txInfo = await handlePromise(repeatAsync(API.getOmniTransaction,
				API_RETRIES)(sendtx), `Could not get omni info for tx ${sendtx}`);
			if (txInfo === null) return;

			refreshAssets();

			notify("success", "New ID number",
				`Your new asset ID number is ${(txInfo as any).propertyid}`);
		});
	});

	// TODO add back predecessor tokens when supported in main
	return <C.Table>
		<thead><tr><C.Header colSpan={4}>Create New Asset</C.Header></tr></thead>
		<tbody>
			<tr>
				<td>Name:</td>
				<td>
					<input type="text" name="name" className="form-field"
						onChange={handleChange} />
				</td>
				{state.assetType === "fixed" && <>
					<td>Amount:</td>
					<td>
						<CoinInput value={state.amount}
							dispatch={cDispatch("set_amount")}
							step={state.isDivisible ? SATOSHI : new N(1)}
							digits={state.isDivisible ? 8 : 0} disabled={false} />
					</td>
				</>}
			</tr>
			<tr>
				<td>Type:</td>
				<td colSpan={3}>
					<select name="assettype" value={state.assetType}
						onChange={handleChangeSel} style={{ marginLeft: 8 }}>
						<option value="managed">Managed Supply</option>
						<option value="fixed">Fixed Supply</option>
						<option value="nft">NFT</option>
					</select>
					{state.assetType !== "nft" && <label>
						<input type="checkbox" name="divisible"
							className="form-field" checked={state.isDivisible}
							onChange={handleChange} />
						Divisible
					</label>}
					<label>
						<input type="checkbox" name="test" className="form-field"
							checked={state.isTest} onChange={handleChange} />
						Test Token
					</label>
				</td>
			</tr>
			<tr>
				<td>Category:</td>
				<td>
					<input type="text" name="category" className="form-field"
						value={state.category} onChange={handleChange} />
				</td>
				{state.hasPre && <>
					<td>Predecessor:</td>
					<C.Asset colSpan={3}>
						<AssetSearch setAssetCallback={cDispatch("set_pre")}
							filter={p => p.id > PROPID_COIN} />
					</C.Asset>
				</>}
			</tr>
			<tr>
				<td>Subcategory:</td>
				<td>
					<input type="text" name="subcategory" className="form-field"
						value={state.subcategory} onChange={handleChange} />
				</td>
				<td>Additional Data:</td>
				<td>
					<input type="text" name="data" className="form-field"
						value={state.data} onChange={handleChange} />
				</td>
			</tr>
			<tr>
				<td>URL:</td>
				<td>
					<input type="text" name="url" className="form-field"
						value={state.url} onChange={handleChange} />
				</td>
				<td colSpan={2}>
					{state.errmsg ? `${SYMBOL_CROSS_MARK} ${state.errmsg}`
						: (state.assetType === "managed" ?
							`${SYMBOL_CHECK_BUTTON} Manage supply in "Modify Asset"`
							: (state.assetType === "nft" ?
								`${SYMBOL_CHECK_BUTTON} Mint NFTs in "Modify Asset"`
								: SYMBOL_CHECK_BUTTON
								+ ` Estimated fee: ${+state.fee}`))}
					<button style={{ marginLeft: 8 }} onClick={doCreate}
						disabled={state.errmsg !== null}>Create</button>
				</td>
			</tr>
		</tbody>
	</C.Table>;
};

type ModifyState = {
	asset: number,
	action: "grant" | "revoke" | "setnft" | "chgissuer",
	isDivisible: boolean,
	isManaged: boolean,
	isNFT: boolean,
	isMine: boolean,
	errmsg: string,
	amount: N,
	newIssuer: string,
	nftRange: [number, number],
	nftDataType: "issuer" | "holder",
	nftData: string,
	grantData: string,
	recipient: string,
	issuerAvailable: N,
	memo: string,
	fee: N,
};

type ModifyAction = {
	type: "set_asset" | "set_action" | "set_divisible" | "set_managed" | "set_nft"
	| "set_mine" | "set_errmsg" | "set_amount" | "set_newissuer" | "set_nftrange_min"
	| "set_nftrange_max" | "set_nftrange" | "set_nftdatatype" | "set_nftdata"
	| "set_grantdata" | "set_recipient" | "set_issuer_available" | "set_memo"
	| "set_fee" | "clear",
	payload?: any,
};

const reducerModify = (state: ModifyState, action: ModifyAction) => {
	const payload = action.payload;
	switch (action.type) {
		case "set_asset":
			return { ...state, asset: payload as ModifyState["asset"] };
		case "set_action":
			return { ...state, action: payload as ModifyState["action"] };
		case "set_divisible":
			return { ...state, isDivisible: payload as ModifyState["isDivisible"] };
		case "set_managed":
			return { ...state, isManaged: payload as ModifyState["isManaged"] };
		case "set_nft":
			return { ...state, isNFT: payload as ModifyState["isNFT"] };
		case "set_mine":
			return { ...state, isMine: payload as ModifyState["isMine"] };
		case "set_errmsg":
			return { ...state, errmsg: payload as ModifyState["errmsg"] };
		case "set_amount":
			return { ...state, amount: payload as ModifyState["amount"] };
		case "set_newissuer":
			return { ...state, newIssuer: payload as ModifyState["newIssuer"] };
		case "set_nftrange_min":
			{
				const range = state.nftRange;
				return {
					...state,
					nftRange: [payload, range[1]] as ModifyState["nftRange"],
				};
			}
		case "set_nftrange_max":
			{
				const range = state.nftRange;
				return {
					...state,
					nftRange: [range[0], payload] as ModifyState["nftRange"],
				};
			}
		case "set_nftrange":
			return { ...state, nftRange: payload as ModifyState["nftRange"] };
		case "set_nftdatatype":
			return { ...state, nftDataType: payload as ModifyState["nftDataType"] };
		case "set_nftdata":
			return { ...state, nftData: payload as ModifyState["nftData"] };
		case "set_grantdata":
			return { ...state, grantData: payload as ModifyState["grantData"] };
		case "set_recipient":
			return { ...state, recipient: payload as ModifyState["recipient"] };
		case "set_issuer_available":
			return {
				...state,
				issuerAvailable: payload as ModifyState["issuerAvailable"],
			};
		case "set_memo":
			return { ...state, memo: payload as ModifyState["memo"] };
		case "set_fee":
			return { ...state, fee: payload as ModifyState["fee"] };
		case "clear":
			{
				let v = { ...initModifyState };
				delete v.asset, v.errmsg;
				return { ...state, ...v };
			}
		default:
			throw new Error("reducerManage called with invalid action type "
				+ action.type);
	}
};

const initModifyState: ModifyState = {
	asset: -1,
	action: "chgissuer",
	isDivisible: true,
	isManaged: false,
	isNFT: false,
	isMine: false,
	errmsg: undefined,
	amount: new N(0),
	newIssuer: "",
	nftRange: [1, 1],
	nftDataType: "issuer",
	nftData: "",
	grantData: "",
	recipient: "",
	issuerAvailable: new N(0),
	memo: "",
	fee: new N(0),
};

const AssetModify = () => {
	const { consts, getClient } = React.useContext(AppContext);

	const [state, dispatch] = React.useReducer(reducerModify, initModifyState);

	const cDispatch = (type: ModifyAction["type"]) => (payload: any) =>
		dispatch({ type, payload });

	const changeMutex = React.useMemo(() => new Mutex(), []);
	const updateMutex = React.useMemo(() => new Mutex(), []);
	const msgMutex = React.useMemo(() => new Mutex(), []);
	const feeMutex = React.useMemo(() => new Mutex(), []);

	const doUpdate = () => updateMutex.runExclusive(async () => {
		if (state.asset === -1) {
			cDispatch("clear");
			return;
		}

		const API = api(getClient());

		const assetInfo = await
			handlePromise(repeatAsync(API.getProperty, API_RETRIES)(state.asset),
				`Could not query property info for ID ${state.asset}`);
		const issuerInfo = await handlePromise(repeatAsync(API.getAddressInfo,
			API_RETRIES)(assetInfo.issuer),
			`Could not query info for address ${assetInfo.issuer}`);
		if (assetInfo === null || issuerInfo === null) return;

		cDispatch("set_mine")(issuerInfo.ismine);
		cDispatch("set_divisible")(assetInfo.divisible);
		cDispatch("set_managed")(assetInfo.managedissuance);
		cDispatch("set_nft")(assetInfo['non-fungibletoken']);

		if (assetInfo['non-fungibletoken']) {
			cDispatch("set_action")("setnft");
			cDispatch("set_nftrange")([1, 1]);
		} else if (assetInfo.managedissuance) {
			const assetBalance = await
				handlePromise(repeatAsync(API.getAssetBalance, API_RETRIES)
					(assetInfo.issuer, state.asset),
					`Could not query asset balance for address ${assetInfo.issuer}`);
			if (assetBalance === null) return;

			cDispatch("set_issuer_available")(new N(assetBalance.balance));
			cDispatch("set_action")("grant");
		}
		else cDispatch("set_action")("chgissuer");
	});

	React.useEffect(() => { doUpdate(); }, [state.asset]);

	const getErrmsg = async () => {
		const client = getClient();
		if (client === null || consts === null) return "Client not initialized";

		const API = api(client);

		if (state.asset === -1) return "Please select asset";
		if (state.action !== "setnft" && !state.isMine)
			return "Wallet does not control asset";

		const assetInfo = await
			handlePromise(repeatAsync(API.getProperty, API_RETRIES)(state.asset),
				`Could not query property info for ID ${state.asset}`);
		if (assetInfo === null) return "Could not query asset info";

		if (state.action === "grant" || state.action === "revoke") {
			if (assetInfo.fixedissuance) return "Asset supply is fixed";
			if (state.amount.lte(0)) return "Amount must be greater than zero";

			if (state.action === "revoke") {
				const assetBalance = await
					handlePromise(repeatAsync(API.getAssetBalance, API_RETRIES)
						(assetInfo.issuer, state.asset),
						"Could not query issuer balance", b => new N(b.balance));
				if (assetBalance === null) return "Could not query issuer balance";

				if (state.amount.gt(assetBalance))
					return "Amount exceeds issuer balance";
			} else {
				const address = state.recipient;
				const validAddress = await
					handlePromise(repeatAsync(API.validateAddress, API_RETRIES)
						(address),
						`Could not process validation for address ${address}`);
				if (validAddress === null)
					return "Could not validate recipient address";
				else if (address.length > 0 && !validAddress.isvalid)
					return "Invalid recipient address";
			}
		} else if (state.action === "chgissuer") {
			const validAddress = await handlePromise(repeatAsync(API.validateAddress,
				API_RETRIES)(state.newIssuer),
				`Could not process validation for address ${state.newIssuer}`);
			if (validAddress === null) return "Could not validate address";
			else if (!validAddress.isvalid) return "Invalid new issuer address";
		} else if (state.action === "setnft") {
			if (!assetInfo['non-fungibletoken']) return "Asset is not NFT";

			const [min, max] = state.nftRange;
			if (min < 0 || max < 0) return "Token IDs out of range";
			if (max < min) return "End of token range must be >= start";

			const nftRanges = await handlePromise(repeatAsync(API.getNFTRanges,
				API_RETRIES_LARGE)(state.asset),
				`Could not query NFT ranges for asset ${state.asset}`);
			if (nftRanges === null) return "Could not query NFT ranges";

			if (nftRanges.length === 0) return "No NFTs available";
			if (min < nftRanges[0].tokenstart) return "Token start out of range";
			if (max > nftRanges[nftRanges.length - 1].tokenend)
				return "Token end out of range";

			if (state.nftDataType === "holder")
				for (let nrange of nftRanges) {
					if (nrange.tokenend < min) continue;
					if (nrange.tokenstart > max) break;

					const holderAddress = nrange.address;
					const addressInfo = await
						handlePromise(repeatAsync(API.getAddressInfo, API_RETRIES)
							(holderAddress), "Could not query address info");
					if (addressInfo === null) return "Could not query address info";
					if (!addressInfo.ismine)
						return "NFT range contains non-owned tokens";
				}
			else if (state.nftDataType === "issuer" && !state.isMine)
				return "Issuer address not in wallet";
		} else return "Invalid action";

		return null;
	};

	React.useEffect(() => {
		msgMutex.runExclusive(async () =>
			cDispatch("set_errmsg")(await getErrmsg()));
	}, [state.asset, state.action, state.recipient, state.newIssuer, state.amount,
	state.isMine, state.nftRange, state.nftDataType, consts]);

	const getFee = () => feeMutex.runExclusive(async () => {
		if (await getErrmsg() !== null) return new N(0);

		const client = getClient();
		const API = api(client);

		const assetInfo = await
			repeatAsync(API.getProperty, API_RETRIES)(state.asset);

		let fee;
		switch (state.action) {
			case "chgissuer":
				fee = (await estimateIssuerFee(consts, client, assetInfo.issuer,
					state.newIssuer)).totalFee;
				break;
			case "setnft": {
				if (state.nftDataType === "issuer")
					// FEE_ADDRESS guaranteed to be classic segwit address
					fee = (await estimateNFTFee(consts, client, state.nftData,
						consts.FEE_ADDRESS, assetInfo.issuer)).totalFee;
				else {
					const nftRanges = await repeatAsync(API.getNFTRanges,
						API_RETRIES_LARGE)(state.asset);

					// Collect fees for the relevant NFT ranges
					let nftFees = [] as Promise<N>[];
					const [min, max] = state.nftRange;
					for (let nrange of nftRanges) {
						if (nrange.tokenend < min) continue;
						if (nrange.tokenstart > max) break;

						const fee = estimateNFTFee(consts, client, state.nftData,
							consts.FEE_ADDRESS, nrange.address).then(fee =>
								fee.totalFee);
						nftFees.push(fee);
					}

					fee = dsum(await Promise.all(nftFees));
				}

				break;
			}
			case "grant":
				fee = (await estimateGrantFee(consts, client, assetInfo.issuer,
					state.recipient.length > 0 ? state.recipient : assetInfo.issuer,
					state.grantData)).totalFee;
				break;
			case "revoke":
				fee = (await estimateRevokeFee(consts, client, assetInfo.issuer,
					state.memo)).totalFee;
				break;
		}

		return fee;
	});

	React.useEffect(() => {
		getFee().then(fee => cDispatch("set_fee")(fee), e => {
			handleError(e, "error");
			cDispatch("set_fee")(new N(0));
		});
	}, [state.asset, state.action, state.recipient, state.newIssuer, state.nftRange,
	state.nftDataType, state.nftData, state.grantData, state.memo, state.errmsg,
		consts]);

	const doModify = () => changeMutex.runExclusive(async () => {
		// Need to validate again
		{
			const msg = await getErrmsg();
			if (msg !== null) {
				sendAlert(msg);
				cDispatch("set_errmsg")(msg);
				return;
			}
		}

		const info = `Asset #${state.asset}; ` + (state.action === "chgissuer" ?
			`Change issuer to ${state.newIssuer}` : (state.action === "setnft" ?
				`Set NFT data for range ${state.nftRange};`
				+ ` type: ${state.nftDataType}; data: ${state.nftData}` :
				(state.action === "grant" ? `Grant ${state.amount} tokens to `
					+ (state.recipient.length > 0 ? state.recipient : "issuer")
					+ ` with grant data: ${state.grantData}` :
					`Revoke ${state.amount} tokens from issuer`)));

		{
			const c =
				sendConfirm(`Are you sure you want to modify this asset? ${info}`);
			if (!c) return;
		}

		const client = getClient();
		const API = api(client);

		const assetInfo = await
			handlePromise(repeatAsync(API.getProperty, API_RETRIES)(state.asset),
				`Could not query property info for ID ${state.asset}`);
		if (assetInfo === null) return;

		switch (state.action) {
			case "chgissuer": {
				log().debug("enter chgissuer")

				const issuerFee: Awaited<ReturnType<typeof estimateIssuerFee>> =
					await estimateIssuerFee(consts, client, assetInfo.issuer,
						state.newIssuer).catch(e => {
							handleError(e, "error");
							return null;
						});
				if (issuerFee === null) return;

				const utxo = await
					fundAddress(client, issuerFee.totalFee, assetInfo.issuer);
				if (utxo === null) return;

				const rawtx = await createRawIssuer(consts, client, state.newIssuer,
					state.asset, utxo, issuerFee.issuerFee).catch(e => {
						handleError(e, "error");
						return null;
					});
				if (rawtx === null) return;

				const signedtx = await signTx(client, rawtx,
					`Could not sign raw change issuer transaction`);
				if (signedtx === null) return;

				const sendtx = await sendTx(client, signedtx,
					`Could not send change issuer transaction`);
				if (sendtx === null) return;

				break;
			}
			case "setnft": {
				if (state.nftDataType === "issuer") {
					log().debug("enter setnft issuer")

					const sender = await
						handlePromise(repeatAsync(API.getNewAddress, API_RETRIES)
							(ACCOUNT_LABEL),
							"Could not get new address for funding NFT transaction");
					if (sender === null) return;

					const nftFee: Awaited<ReturnType<typeof estimateNFTFee>> =
						await estimateNFTFee(consts, client, state.nftData,
							consts.FEE_ADDRESS, assetInfo.issuer).catch(e => {
								handleError(e, "error");
								return null;
							});
					if (nftFee === null) return;

					const utxo = await fundAddress(client, nftFee.totalFee, sender);
					if (utxo === null) return;

					const rawtx = await
						createRawSetNFT(consts, client, assetInfo.issuer,
							state.asset, state.nftRange[0], state.nftRange[1], true,
							state.nftData, utxo, nftFee.nftFee).catch(e => {
								handleError(e, "error");
								return null;
							});
					if (rawtx === null) return;

					const signedtx = await signTx(client, rawtx,
						`Could not sign raw set NFT data transaction (issuer)`);
					if (signedtx === null) return;

					const sendtx = await sendTx(client, signedtx,
						`Could not send set NFT data transaction (issuer)`);
					if (sendtx === null) return;
				} else {
					log().debug("enter setnft holder")

					const nftRanges = await
						handlePromise(repeatAsync(API.getNFTRanges,
							API_RETRIES_LARGE)(state.asset),
							`Could not query NFT ranges for asset ${state.asset}`);
					if (nftRanges === null) return "Could not query NFT ranges";

					// Collect the relevant NFT ranges
					let setRanges = [] as NFTRange[];
					{
						const [min, max] = state.nftRange;
						for (let nrange of nftRanges) {
							if (nrange.tokenend < min) continue;
							if (nrange.tokenstart > max) break;

							setRanges.push({
								...nrange,
								tokenstart: Math.max(min, nrange.tokenstart),
								tokenend: Math.min(max, nrange.tokenend),
							});
						}
					}

					// Get all the fees for them
					const nftFees: Awaited<ReturnType<typeof estimateNFTFee>>[] =
						await Promise.all(setRanges.map(range =>
							estimateNFTFee(consts, client, state.nftData,
								range.address))).catch(e => {
									handleError(e, "error");
									return null;
								});
					if (nftFees === null) return;

					// send for each range
					for (let i = 0; i < setRanges.length; i++) {
						const nrange = setRanges[i];
						const fee = nftFees[i];
						const holder = nrange.address;
						const [min, max] = [nrange.tokenstart, nrange.tokenend];

						const utxo = await fundAddress(client, fee.totalFee, holder);
						if (utxo === null) return;

						const rawtx = await createRawSetNFT(consts, client, holder,
							state.asset, min, max, false, state.nftData, utxo,
							fee.nftFee).catch(e => {
								handleError(e, "error");
								return null;
							});
						if (rawtx === null) return;

						const signedtx = await signTx(client, rawtx,
							`Could not sign raw set NFT data transaction (holder)`);
						if (signedtx === null) return;

						const sendtx = await sendTx(client, signedtx,
							`Could not send set NFT data transaction (holder)`);
						if (sendtx === null) return;
					}
				}

				break;
			}
			case "grant": {
				log().debug("entering grant")

				const grantData = state.grantData.length > 0 ?
					state.grantData : undefined;

				const grantFee: Awaited<ReturnType<typeof estimateGrantFee>> =
					await estimateGrantFee(consts, client, assetInfo.issuer,
						state.recipient.length > 0 ? state.recipient
							: assetInfo.issuer, state.grantData).catch(e => {
								handleError(e, "error");
								return null;
							});
				if (grantFee === null) return;

				const utxo = await
					fundAddress(client, grantFee.totalFee, assetInfo.issuer);
				if (utxo === null) return;

				const rawtx = await
					createRawGrant(consts, client, state.asset, state.amount, utxo,
						grantFee.grantFee, state.recipient.length > 0 ?
						state.recipient : utxo.address, grantData).catch(e => {
							handleError(e, "error");
							return null;
						});
				if (rawtx === null) return;

				const signedtx = await signTx(client, rawtx,
					`Could not sign raw grant transaction`);
				if (signedtx === null) return;

				const sendtx = await sendTx(client, signedtx,
					`Could not send set grant transaction`);
				if (sendtx === null) return;

				break;
			}
			case "revoke": {
				log().debug("entering revoke")

				const memo = state.memo.length > 0 ? state.memo : undefined;

				const revokeFee: Awaited<ReturnType<typeof estimateRevokeFee>> =
					await estimateRevokeFee(consts, client, assetInfo.issuer,
						state.memo).catch(e => {
							handleError(e, "error");
							return null;
						});
				if (revokeFee === null) return;

				const utxo = await
					fundAddress(client, revokeFee.totalFee, assetInfo.issuer);
				if (utxo === null) return;

				const rawtx = await createRawRevoke(consts, client, state.asset,
					state.amount, utxo, revokeFee.revokeFee, memo).catch(e => {
						handleError(e, "error");
						return null;
					});
				if (rawtx === null) return;

				const signedtx = await signTx(client, rawtx,
					`Could not sign raw revoke transaction`);
				if (signedtx === null) return;

				const sendtx = await sendTx(client, signedtx,
					`Could not send set revoke transaction`);
				if (sendtx === null) return;

				break;
			}
			default:
				handleError(new Error(`invalid action ${state.action}`), "error");
		}

		notify("success", "Modified asset", info);
	});

	const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const target = event.target;
		const value = target.type === "checkbox" ? target.checked : target.value;
		const name = target.name;

		switch (name) {
			case "issuer": cDispatch("set_newissuer")(value);
				break;
			case "recipient": cDispatch("set_recipient")(value);
				break;
			case "min": cDispatch("set_nftrange_min")(value);
				break;
			case "max": cDispatch("set_nftrange_max")(value);
				break;
			case "nftdata": cDispatch("set_nftdata")(value);
				break;
			case "grantdata": cDispatch("set_grantdata")(value);
				break;
			case "memo": cDispatch("set_memo")(value);
		}
	};

	const handleChangeSel = (event: React.ChangeEvent<HTMLSelectElement>) => {
		const target = event.target;
		const value = target.value;
		const name = target.name;

		switch (name) {
			case "action": cDispatch("set_action")(value);
				break;
			case "nftdatatype": cDispatch("set_nftdatatype")(value);
				break;
		}
	};

	return <C.Table>
		<thead><tr><C.Header colSpan={4}>Modify Asset</C.Header></tr></thead>
		<tbody>
			<tr>
				<td>Asset:</td>
				<C.Asset>
					<AssetSearch setAssetCallback={cDispatch("set_asset")}
						filter={p => p.id > PROPID_COIN} />
				</C.Asset>
				{state.isManaged
					&& (state.action === "grant" || state.action === "revoke")
					&& <>
						<td>Amount:</td>
						<td>
							<CoinInput value={state.amount}
								dispatch={cDispatch("set_amount")}
								step={state.isDivisible ? SATOSHI : new N(1)}
								digits={state.isDivisible ? 8 : 0}
								disabled={false} />
						</td>
					</>}
			</tr>
			<tr>
				<td>Action:</td>
				<td>
					<select name="action" value={state.action}
						onChange={handleChangeSel} style={{ marginLeft: 8 }}>
						{state.isManaged
							&& <option value="grant">Grant Tokens</option>}
						{state.isManaged
							&& <option value="revoke">Revoke Tokens</option>}
						{state.isNFT
							&& <option value="setnft">Set NFT Data</option>}
						<option value="chgissuer">Change Issuer</option>
					</select>
					{state.isNFT && state.action === "setnft"
						&& <select style={{ marginLeft: 8 }} name="nftdatatype"
							value={state.nftDataType} onChange={handleChangeSel}>
							<option value="issuer">Issuer Data</option>
							<option value="holder">Holder Data</option>
						</select>}
				</td>
				{(state.isManaged || state.isNFT) && state.action === "grant" && <>
					<td>Recipient address:</td>
					<td>
						<C.Address type="text" name="recipient"
							value={state.recipient} onChange={handleChange}
							placeholder="Default: Issuer" />
					</td>
				</>}
				{(state.isManaged || state.isNFT) && state.action === "revoke" && <>
					<td>Available balance:</td>
					<td>
						<input type="number" name="available"
							className="coin form-field"
							value={state.issuerAvailable.toFixed(state.isDivisible ?
								8 : 0)} min={0} readOnly />
					</td>
				</>}
			</tr>
			<tr>
				{state.action === "chgissuer" && <>
					<td>Change issuer:</td>
					<td>
						<C.Address type="text" name="issuer" value={state.newIssuer}
							onChange={handleChange} placeholder="Issuer address" />
					</td>
				</>}
				{state.isNFT && state.action === "setnft" && <>
					<td>Token range:</td>
					<td>
						<C.RangeNumber type="number" name="min"
							min={1} max={state.nftRange[1]}
							value={state.nftRange[0]} onChange={handleChange} />
						<C.RangeNumber type="number" name="max"
							min={state.nftRange[0]}
							value={state.nftRange[1]} onChange={handleChange} />
					</td>
					<td>Data:</td>
					<td><input type="text" name="nftdata" className="form-field"
						value={state.nftData} onChange={handleChange} /></td>
				</>}
				{state.isNFT && state.action === "grant" && <>
					<td>Grant data:</td>
					<td colSpan={3}><input type="text" name="grantdata"
						style={{ marginLeft: 8, minWidth: "20em" }}
						value={state.grantData} onChange={handleChange} /></td>
				</>}
				{state.action === "revoke" && <>
					<td>Memo:</td>
					<td colSpan={3}><input type="text" name="memo"
						style={{ marginLeft: 8, minWidth: "20em" }}
						placeholder="Default: none"
						value={state.memo} onChange={handleChange} /></td>
				</>}
			</tr>
			<tr>
				<td colSpan={4}>
					{state.errmsg ? `${SYMBOL_CROSS_MARK} ${state.errmsg}`
						: `${SYMBOL_CHECK_BUTTON} Estimated fee: ${+state.fee}`}
					<button style={{ marginLeft: 8 }} onClick={doModify}
						disabled={state.errmsg !== null}>Change</button>
				</td>
			</tr>
		</tbody>
	</C.Table >;
};

const AssetManage = () => {
	return <C.Container><AssetCreate /><AssetModify /></C.Container>;
};

export default AssetManage;