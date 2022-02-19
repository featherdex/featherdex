import React from 'react';
import urlRegex from 'url-regex';
import styled from 'styled-components';

import AppContext from '../contexts/AppContext';

import api from '../api';
import Table from './Table';
import AssetSearch from './AssetSearch';

import { handleError, repeatAsync, toFormattedAmount, sendOpenLink } from '../util';

type NFTTableProps = {
	data: NFTInfo[],
};

const NFTTable = ({ data }: NFTTableProps) => {
	const columns = React.useMemo(() => [
		{
			Header: 'Index',
			accessor: 'index',
			width: 50,
		},
		{
			Header: 'Owner',
			accessor: 'owner',
			width: 140,
		},
		{
			Header: 'Grant Data',
			accessor: 'grantdata',
			width: 220,
			Cell: (props: Record<string, any>) =>
				urlRegex({ exact: true }).test(props.value) ?
					((/\.(gif|jpe?g|tiff?|png|webp|bmp)$/i).test(props.value) ?
						<a href="#" onClick={() => sendOpenLink(props.value)}>
							<img src={props.value} width="100%" />
						</a> :
						<a href="#" onClick={() => sendOpenLink(props.value)}></a>)
					: props.value,
		},
		{
			Header: 'Issuer Data',
			accessor: 'issuerdata',
			width: 100,
		},
		{
			Header: 'Holder Data',
			accessor: 'holderdata',
			width: 100,
		},
	], []);

	return <Table className="nft-table"
		columns={columns} data={data} overflow select />;
};

const C = {
	InfoTable: styled.div`
	display: flex;
	flex-flow: column;
	height: 100%;`,
	InfoBody: styled.div`flex: 1 1 auto;`,
	InfoContent: styled.div`
	padding: 0 16px 0 16px;
	font-size: 10pt;
	& td:first-child {
		width: 150px;
	}`,
	InfoHeader: styled.div`
	display: flex;
	flex: 0 1 auto;
	& > *:first-child {
		height: 24px;
		width: 50px;
		padding: 0 8px 0 8px;
	}
	& > *:nth-child(2) {
		flex-grow: 1;
		min-width: 200px;
	}`,
}

const Info = () => {
	const { consts, settings, getClient } = React.useContext(AppContext);

	const [asset, setAsset] = React.useState(-1);
	const [assetInfo, setAssetInfo] = React.useState<AssetInfo>(null);
	const [nftInfo, setNFTInfo] = React.useState<NFTInfo[]>([]);

	const format = (info: AssetInfo) => {
		const { COIN_LOGO_PATH = "" } = (consts ?? {});
		let logo;

		if (info.propertyid === 0)
			logo = <td rowSpan={10}>
				<img src="../img/logo-btc-256px.png"
					style={{
						paddingLeft: "64px",
						width: "128px", height: "128px"
					}} />
			</td>;
		else if (info.propertyid === 1)
			logo = <td rowSpan={10}>
				<img src={COIN_LOGO_PATH}
					style={{
						paddingLeft: "64px",
						width: "128px", height: "128px"
					}} />
			</td>;

		return <C.InfoContent>
			<h2>{info.name}</h2>
			<table>
				<tbody>
					<tr>
						<td>Property ID:</td>
						<td>{info.propertyid}</td>
						{logo ? logo : <></>}
					</tr>
					<tr>
						<td>Category:</td>
						<td>{info.category.length > 0 ? info.category : "none"}
							{info.subcategory.length > 0 ?
								` > ${info.subcategory}` : ""}</td>
					</tr>
					<tr>
						<td>URL:</td>
						<td>{info.url.length > 0 ?
							<a href="#" onClick={() => sendOpenLink(info.url)}>
								{info.url}</a> : "none"}</td>
					</tr>
					<tr>
						<td>Data:</td>
						<td>{info.data.length > 0 ? info.data : "no data"}</td>
					</tr>
					<tr>
						<td>Issuer:</td>
						<td>{info.issuer.length > 0 ? info.issuer : "coin"}</td>
					</tr>
					<tr>
						<td>Creation transaction ID:</td>
						<td>{info.creationtxid.length > 0 ?
							info.creationtxid : "genesis"}</td>
					</tr>
					<tr>
						<td>Total tokens:</td>
						<td>{toFormattedAmount(parseFloat(info.totaltokens),
							settings.numformat, 8, "decimal", "none")}</td>
					</tr>
					<tr>
						<td>Issuance:</td>
						<td>{info.fixedissuance ? "fixed" :
							(info.managedissuance ? "managed" : "mined")}</td>
					</tr>
					<tr>
						<td>Is divisible?</td>
						<td>{info.divisible ? "\u2713" : ""}</td>
					</tr>
					<tr>
						<td>Is NFT?</td>
						<td>{info["non-fungibletoken"] ? "\u2713" : ""}</td>
					</tr>
				</tbody>
			</table>
			{nftInfo.length > 0 ? <>
				<h3>NFT Data</h3>
				<NFTTable data={nftInfo} />
			</> : <></>}
		</C.InfoContent>;
	}

	React.useEffect(() => {
		if (asset === -1) return;

		const client = getClient();
		if (client === null || consts === null) return;

		const { COIN_NAME, COIN_URL, COIN_SUPPLY } = consts;
		const API = api(client);

		const btcinfo: AssetInfo = {
			propertyid: 0,
			name: "Bitcoin",
			category: "Core",
			subcategory: "",
			data: "",
			url: "https://bitcoin.org/",
			divisible: true,
			issuer: "",
			creationtxid: "",
			fixedissuance: false,
			managedissuance: false,
			"non-fungibletoken": false,
			totaltokens: "21000000.00000000",
		};

		const coininfo: AssetInfo = {
			propertyid: 1,
			name: COIN_NAME,
			category: "Core",
			subcategory: "",
			data: "",
			url: COIN_URL,
			divisible: true,
			issuer: "",
			creationtxid: "",
			fixedissuance: false,
			managedissuance: false,
			"non-fungibletoken": false,
			totaltokens: COIN_SUPPLY.toFixed(8),
		}

		if (asset === 0) {
			setAssetInfo(btcinfo);
			return;
		}

		if (asset === 1) {
			setAssetInfo(coininfo);
			return;
		}

		repeatAsync(API.getProperty, 5)(asset).then(v => {
			setAssetInfo(v);
			if (v["non-fungibletoken"])
				repeatAsync(API.getNFTData, 3)(v.propertyid).catch(_ => {
					handleError(new Error("Could not query NFT info"));
					return [];
				}).then(info => setNFTInfo(info));
			else
				setNFTInfo([]);
		}, _ => {
			handleError(new Error("Could not get asset information. Is the"
				+ " daemon running and the app path correctly configured?"),
				"error");
			setAssetInfo(null);
		});

	}, [asset]);

	return <C.InfoTable>
		<C.InfoHeader>
			<span>Asset: </span>
			<AssetSearch setAssetCallback={setAsset} />
		</C.InfoHeader>
		<C.InfoBody>
			{assetInfo ? format(assetInfo) :
				<div className="empty">
					<span style={{ fontSize: 12 }}>Enter an asset</span>
				</div>}
		</C.InfoBody>
	</C.InfoTable>;
};

export default Info;