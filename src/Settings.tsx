"use strict";

import React from 'react';
import Modal from 'react-modal';
import styled from 'styled-components';

import { ipcRenderer, OpenDialogReturnValue } from 'electron';

import AppContext from './contexts/AppContext';

import { US_NUMF, EU_NUMF, IN_NUMF, FR_NUMF } from './constants';

import './app.css';

type SettingsProps = {
	constants: PlatformConstants,
	isOpen: boolean,
	closeModalCallback: () => void,
};

const Container = styled.div`
width: 100%;
height: 100%;
display: flex;
flex-direction: column;
`;

const Body = styled.div`
flex: 1;
overflow: auto;
`;

const C = {
	FormElement: styled.label`display: block;`,
};

export default function Settings
	({ constants, isOpen, closeModalCallback }: SettingsProps) {
	const { settings, setSettings, saveSettings } = React.useContext(AppContext);

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

		setSettings({ [name]: value });
	}

	ipcRenderer.on("choose:conf", (_, data: OpenDialogReturnValue) => {
		if (!data.canceled && data.filePaths.length === 1)
			setSettings({ dconfpath: data.filePaths[0] });
	});

	return <div>
		<Modal isOpen={isOpen}
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
			}}>
			<Container>
				<h2>Settings</h2>
				<Body>
					<h3>{constants.COIN_OMNI_NAME} application</h3>
					<label>{constants.COIN_NAME} config location:&nbsp;
						<input type="text" className="dconfpath form-field"
							name="dconfpath" value={settings.dconfpath} size={40}
							onChange={handleChange} style={{ marginRight: "10px" }} />
						<button onClick={() => ipcRenderer.send("choose", {
							rcvChannel: "choose:conf",
							options: {
								title: "Choose Config File...",
								filters: [{
									name: `${constants.COIN_NAME} Config Files`,
									extensions: ["conf"],
								},
								{ name: "All Files", extensions: ["*"] }],
								properties: ["openFile"],
							}
						})}>Choose File</button>
					</label>
					<div>
						<h3>Number display format</h3>
						<C.FormElement>
							<input type="radio" name="numformat-us"
								checked={settings.numformat === US_NUMF}
								onChange={handleChange} /> 100,000.00
						</C.FormElement>
						<C.FormElement>
							<input type="radio" name="numformat-eu"
								checked={settings.numformat === EU_NUMF}
								onChange={handleChange} /> 100.000,00
						</C.FormElement>
						<C.FormElement>
							<input type="radio" name="numformat-in"
								checked={settings.numformat === IN_NUMF}
								onChange={handleChange} /> 1,00,000.00
						</C.FormElement>
						<C.FormElement>
							<input type="radio" name="numformat-fr"
								checked={settings.numformat === FR_NUMF}
								onChange={handleChange} /> 100 000,00
						</C.FormElement>
					</div>
					<div>
						<h3>Bittrex API (stored plaintext)</h3>
						<label style={{ marginRight: "10px" }}>API key:&nbsp;
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
				</Body>
				<div>
					<div className="ok-cancel">
						<button onClick={saveSettings}>Apply</button>
						<button onClick={() => {
							saveSettings();
							closeModalCallback();
						}}>Apply and close</button>
						<button onClick={closeModalCallback}>Cancel</button>
					</div>
				</div>
			</Container>
		</Modal>
	</div>
		;
};