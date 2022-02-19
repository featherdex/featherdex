import React from 'react';
import styled from 'styled-components';
import NumberFormat from 'react-number-format';
import N from 'decimal.js';

import { NumberFormatValues } from 'react-number-format';

import { SYMBOL_UP, SYMBOL_DOWN } from '../constants';

const C = {
	Container: styled.div`
	display: flex;
	flex-direction: row;
	`,
	ButtonsContainer: styled.div`
	display: flex;
	flex-direction: column;
	width: 21px;
	height: 21px;
	
	& > button {
		flex: 1;
		padding: 0;
		font-size: 5pt;
		height: 50%;
	}
	`
};

type CoinInputProps = {
	value: Decimal,
	dispatch: (v: any) => void,
	step: Decimal,
	digits?: number,
	disabled?: boolean,
};

const CoinInput = ({ value, dispatch, step, digits = 8, disabled = false }:
	CoinInputProps) => {
	const handleChange = React.useCallback((values: NumberFormatValues) =>
		dispatch(new N(values.value)), [dispatch]);

	return <C.Container>
		<NumberFormat value={value.toFixed(digits)} onValueChange={handleChange}
			className="coin form-field" decimalScale={digits}
			allowLeadingZeros={false} fixedDecimalScale={true}
			allowNegative={false} disabled={disabled} />
		<C.ButtonsContainer>
			<button onClick={() => dispatch(value.add(step))}>{SYMBOL_UP}</button>
			<button disabled={value.minus(step).lt(0)} onClick={() =>
				dispatch(value.sub(step))}>{SYMBOL_DOWN}</button>
		</C.ButtonsContainer>
	</C.Container>;
};

export default CoinInput;