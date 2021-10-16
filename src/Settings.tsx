"use strict";

import React from 'react';
import Modal from 'react-modal';

import AppContext from './contexts/AppContext';
import { US_NUMF, EU_NUMF, IN_NUMF, FR_NUMF, FCONF_NAME } from './constants';

import './app.css';

type SettingsProps = {
	isOpen: boolean,
	setSettingsCallback: (s: Record<string, any>) => void,
	closeModalCallback: () => void,
	saveModalCallback: () => void,
};

export default function Settings({ isOpen,
	setSettingsCallback, closeModalCallback, saveModalCallback }
	: SettingsProps) {
	const { settings } = React.useContext(AppContext);

	const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const target = event.target;
		var value = target.type === "checkbox" || target.type === "radio" ?
			target.checked : target.value;
		var name = target.name;

		if (name.startsWith("numformat-"))
			[name, value] = ["numformat",
				name === "numformat-us" ?
					US_NUMF :
					(name === "numformat-eu" ?
						EU_NUMF :
						(name === "numformat-in" ? IN_NUMF : FR_NUMF))];

		if (name === "dconf")
			name = "dconfpath";

		setSettingsCallback({ [name]: value });
	}

	return <div>
		<Modal
			isOpen={isOpen}
			onRequestClose={closeModalCallback}
			shouldCloseOnOverlayClick={false}
			shouldCloseOnEsc={false}
			contentLabel="Settings"
			style={{
				content: {
					background: '#17172d',
					color: '#fff',
				},
				overlay: {
					zIndex: 3
				}
			}}
		>
			<h2>Settings</h2>
			<div className="settings-body">
				<h3>Omnifeather application</h3>
				<label>Feathercoin config location:&nbsp;
					<input type="text" className="dconfpath form-field"
						name="dconfpath" value={settings.dconfpath} size={40}
						onChange={handleChange} />
					<input type="file" className="dconf" name="dconf"
						onChange={handleChange} />
				</label>
				<div>
					<h3>Number display format</h3>
					<label className="form-element">
						<input type="radio" name="numformat-us"
							checked={settings.numformat === US_NUMF}
							onChange={handleChange} /> 100,000.00
					</label>
					<label className="form-element">
						<input type="radio" name="numformat-eu"
							checked={settings.numformat === EU_NUMF}
							onChange={handleChange} /> 100.000,00
					</label>
					<label className="form-element">
						<input type="radio" name="numformat-in"
							checked={settings.numformat === IN_NUMF}
							onChange={handleChange} /> 1,00,000.00
					</label>
					<label className="form-element">
						<input type="radio" name="numformat-fr"
							checked={settings.numformat === FR_NUMF}
							onChange={handleChange} /> 100 000,00
					</label>
				</div>
				<div>
					<h3>Bittrex API (stored plaintext)</h3>
					<label>API key:&nbsp;
						<input type="text" className="apikey form-field"
							name="apikey" value={settings.apikey}
							size={32} onChange={handleChange} />
					</label>
					<label>API secret:&nbsp;
						<input type="password" className="apsecret form-field"
							name="apisecret" value={settings.apisecret}
							size={32} onChange={handleChange} />
					</label>
				</div>
			</div>
			<div className="ok-cancel">
				<button onClick={saveModalCallback}>Apply</button>
				<button onClick={() => {
					saveModalCallback();
					closeModalCallback();
				}}>Apply and close</button>
				<button onClick={closeModalCallback}>Cancel</button>
			</div>
		</Modal>
	</div>
		;
};