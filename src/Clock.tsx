import React from 'react';
import useInterval from 'use-interval';

import AppContext from './contexts/AppContext';

import { DateTime } from 'luxon';

type ClockProps = {
	prefix: string,
};

const Clock = ({ prefix }: ClockProps) => {
	const { settings } = React.useContext(AppContext);
	
	const [timeString, setTimeString] = React.useState("--");
	const [UTCTimeString, setUTCTimeString] = React.useState("--");
	
	const dtformat = {...DateTime.DATE_SHORT, ...DateTime.TIME_WITH_SHORT_OFFSET};

	const updateClock = () => {
		const now = DateTime.now().setLocale(settings.numformat);
		
		setUTCTimeString(now.toUTC().toLocaleString(dtformat))
		setTimeString(prefix + now.toLocaleString(dtformat));
	}

	useInterval(updateClock, 1000, true);

	return <div title={UTCTimeString}>{timeString}</div>;
}

export default Clock;