import React from 'react';

import { ReactSearchAutocomplete } from 'react-search-autocomplete';

import AppContext from './contexts/AppContext';

type AssetSearchProps = {
	setAssetCallback: (a: number) => void,
	disableCallback?: (v: boolean) => void,
	zIndex?: number,
	filter?: (v: Property) => boolean,
}

const AssetSearch = ({ setAssetCallback, disableCallback = _ => { }, zIndex = 1,
	filter }: AssetSearchProps) => {
	const { assetList } = React.useContext(AppContext);
	const assets = filter ? assetList.filter(filter) : assetList;

	return <ReactSearchAutocomplete
		items={assets}
		onSelect={(item: Property) =>
			setAssetCallback(item.id)}
		onSearch={() => disableCallback(false)}
		onClear={() => setAssetCallback(-1)}
		showIcon={false}
		fuseOptions={{
			shouldSort: true,
			threshold: 0.6,
			location: 0,
			distance: 100,
			maxPatternLength: 32,
			minMatchCharLength: 1,
			keys: [
				"name",
				"id",
			],
		}}
		resultStringKeyName="name" placeholder="ID/name"
		styling={{
			clearIconMargin: "0",
			fontFamily: "monospace !important",
			fontSize: "9pt",
			backgroundColor: "white",
			padding: "0 2px 0 2px",
			border: "2px solid #dfe1e5",
			borderRadius: 0,
			height: "20px",
			zIndex: zIndex,
		}} />;
};

export default AssetSearch;