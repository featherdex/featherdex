"use strict";

import React from 'react';

import { DateTime } from 'luxon';
import { Column } from 'react-table';

import AppContext from './contexts/AppContext';
import Table from './Table';

import { toFormattedAmount } from './util';

const Markets = () => {
	const { settings, tickers } = React.useContext(AppContext);

	const columns: Column<Record<string, any>>[] = React.useMemo(() => settings ? [
		{
			Header: 'Market',
			accessor: 'market',
			width: 150,
			Cell: props => props.value,
		},
		{
			Header: 'Last',
			accessor: 'last',
			width: 80,
			Cell: props =>
				<span title={props.value.time.setLocale(settings.numformat)
					.toLocaleString({
						...DateTime.DATE_MED,
						...DateTime.TIME_24_WITH_SHORT_OFFSET,
					})}>
					{toFormattedAmount(props.value.price, settings.numformat, 8,
						"decimal", "none")}
				</span>,
		},
		{
			Header: 'Chg',
			accessor: 'chg',
			width: 75,
			Cell: props => toFormattedAmount(props.value, settings.numformat, 8),
		},
		{
			Header: 'Chg %',
			accessor: 'chgp',
			width: 60,
			Cell: props => toFormattedAmount(props.value, settings.numformat, 1,
				"percent"),
		},
		{
			Header: 'Bid',
			accessor: 'bid',
			width: 75,
			Cell: props => toFormattedAmount(props.value, settings.numformat, 8,
				"decimal", "none"),
		},
		{
			Header: 'Ask',
			accessor: 'ask',
			width: 75,
			Cell: props => toFormattedAmount(props.value, settings.numformat, 8,
				"decimal", "none"),
		},
		{
			Header: 'Volume (24h)',
			accessor: 'vol',
			width: 100,
			Cell: props => toFormattedAmount(props.value, settings.numformat, 8,
				"decimal", "none"),
		},
	] : [],
		[settings]
	);

	const data = React.useMemo(() => Array.from(tickers.values()).sort((a, b) =>
		b.vol - a.vol), [tickers]);

	if (data && data.length > 0)
		return <Table className="markets-table" columns={columns} data={data} />;
	else
		return <div className="empty" style={{ fontSize: 12 }}>
			No active markets
		</div>;
};

export default Markets;
