import React from 'react';
import urlRegex from 'url-regex';

import AppContext from './contexts/AppContext';

import api from './api';
import Table from './Table';
import AssetSearch from './AssetSearch';

import {
	handlePromise, handleError, repeatAsync, toFormattedAmount, openLink
} from './util';

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
						<a href="#" onClick={() => openLink(props.value)}>
							<img src={props.value} width="100%" />
						</a> :
						<a href="#" onClick={() => openLink(props.value)}></a>)
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

const Info = () => {
	const { settings, getClient } = React.useContext(AppContext);

	const [asset, setAsset] = React.useState(-1);
	const [assetInfo, setAssetInfo] = React.useState<AssetInfo>(null);
	const [nftInfo, setNFTInfo] = React.useState<NFTInfo[]>([]);

	const format = (info: AssetInfo) => {
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
				<img src="../img/logo-ftc-256px.png"
					style={{
						paddingLeft: "64px",
						width: "128px", height: "128px"
					}} />
			</td>;

		return <div className="info-content">
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
							<a href="#" onClick={() => openLink(info.url)}>
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
		</div>;
	}

	React.useEffect(() => {
		if (asset === -1) return;

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
			totaltokens: "21000000.00000000"
		};

		const ftcinfo: AssetInfo = {
			propertyid: 1,
			name: "Feathercoin",
			category: "Core",
			subcategory: "",
			data: "",
			url: "https://feathercoin.com/",
			divisible: true,
			issuer: "",
			creationtxid: "",
			fixedissuance: false,
			managedissuance: false,
			"non-fungibletoken": false,
			totaltokens: "336000000.00000000"
		}

		if (asset === 0) {
			setAssetInfo(btcinfo);
			return;
		}

		if (asset === 1) {
			setAssetInfo(ftcinfo);
			return;
		}

		const API = api(getClient());
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

	return <div className="info-table">
		<div className="info-header">
			<span>Asset: </span>
			<AssetSearch setAssetCallback={setAsset} />
		</div>
		<div className="info-body">
			{assetInfo ? format(assetInfo) :
				<div className="empty">
					<span style={{ fontSize: 12 }}>Enter an asset</span>
				</div>}
		</div>
	</div>;
};

export default Info;