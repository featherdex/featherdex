import React from 'react';
import {
	Column, useTable, useBlockLayout, useResizeColumns
} from 'react-table';

import { uniqueId } from './util';

type TableProps = {
	className: string,
	columns: Column<Record<string, any>>[],
	data: Record<string, number | string | JSX.Element>[],
	overflow?: boolean,
	select?: boolean,
};

const dataEqual = (prevProps: TableProps, nextProps: TableProps) => {
	if (prevProps.data.length !== nextProps.data.length) return false;

	return prevProps.data.every((v, i) => {
		const a = Object.entries(v), b = Object.entries(nextProps.data[i]);
		return a.length === b.length && a.every((w, j) =>
			w[0] === b[j][0] && w[1] === b[j][1]);
	});
}

const Table = ({ className, columns, data, overflow, select }: TableProps) => {
	const defaultColumn = React.useMemo(
		() => ({
			minWidth: 30,
			width: 150,
			maxWidth: 400,
		}),
		[]
	);

	const {
		getTableProps,
		getTableBodyProps,
		headerGroups,
		rows,
		prepareRow,
		state,
	} = useTable(
		{
			columns,
			data,
			defaultColumn,
		},
		useBlockLayout,
		useResizeColumns,
	);

	const tableHeader = <div className="table-header">
		{headerGroups.map((headerGroup: any) => (
			<div key={uniqueId("table-hg-")}
				{...headerGroup.getHeaderGroupProps()} className="tr">
				{headerGroup.headers.map((column: any) => (
					<div key={uniqueId("table-h-")}
						{...column.getHeaderProps()} className="th">
						{column.render('Header')}
						<div
							{...column.getResizerProps()}
							className={
								`resizer ${column.isResizing ?
									'isResizing' : ''
								}`}
						/>
					</div>
				))}
			</div>
		))}
	</div>;

	const tableBody = <div {...getTableBodyProps()} className="table-body">
		{rows.map((row, i) => {
			prepareRow(row)
			return (
				<div key={uniqueId("table-row-")}
					{...row.getRowProps()} className="tr">
					{row.cells.map(cell => {
						return (
							<div key={uniqueId("table-cell-")}
								{...cell.getCellProps()}
								className={`td${overflow ?
									" table-overflow" : ""}
									${select ? " table-select" : ""}`}>
								{cell.render('Cell')}
							</div>
						)
					})}
				</div>
			)
		})}
	</div>;

	return (
		<div className={className}>
			<div {...getTableProps()} className="table">
				{tableHeader}{tableBody}
			</div>
		</div>
	)
};

export default React.memo(Table, dataEqual);