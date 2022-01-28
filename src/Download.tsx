import React from 'react';
import Modal from 'react-modal';
import styled from 'styled-components';

import { ipcRenderer } from 'electron';
import { Line } from 'rc-progress';

import AppContext from './contexts/AppContext';

import { downloadFile, uniqueId, promiseStatus } from './util';
import { X_SYMBOL } from './constants';

type DownloadInfoProps = {
	id: string,
	url: string,
	path: string,
	down: number,
	total: number,
	pct: number,
	closeDownload: (id: string) => void,
	status: "Downloading" | "Cancelling" | "Stopped",
};

type DownloadObj = Omit<DownloadInfoProps, "closeDownload" | "isAbort"> &
{ download: ReturnType<typeof downloadFile> };

type DownloadProps = {
	isOpen: boolean,
	closeModalCallback: () => void,
}

const C = {
	DownloadInfo: {
		Container: styled.div`
	display: flex;
	height: 100px;
	flex-direction: row;`,
		Body: styled.div`
	width: 90%;
	padding: 4px 12px 4px 12px;
	& div.download-line {
		white-space: nowrap;
		overflow: hidden;
		padding-bottom: 4px;
	}`,
		X: styled.div`
	display: flex;
	width: 10%;
	height: 100%;
  	justify-content: center;
  	align-items: center;
  	&:hover {
    	background-color: rgba(255, 255, 255, 0.1);
  	}`,
		Status: styled.div`float: left;`,
		Progress: styled.div`float: right;`,
	},
	Download: {
		Container: styled.div`
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;`,
		Body: styled.div`
	flex: 1;
	display: flex;
	flex-flow: column wrap;
	overflow: auto;`,
	},
};

const DownloadInfo = ({ id, url, path, down, total, pct, closeDownload, status }:
	DownloadInfoProps) => {
	return <C.DownloadInfo.Container>
		<C.DownloadInfo.Body>
			<div className="download-line">Download: {url}</div>
			<div className="download-line">Save to: <a target="_blank" onClick={() =>
				ipcRenderer.send("shell:opencont", path)}>{path}</a></div>
			<div><Line percent={pct} /></div>
			<div className="download-line">
				<C.DownloadInfo.Status>{status}</C.DownloadInfo.Status>
				<C.DownloadInfo.Progress>
					Download progress: {pct}%, {down} MB/{total} MB
				</C.DownloadInfo.Progress>
			</div>
		</C.DownloadInfo.Body>
		<C.DownloadInfo.X onClick={() =>
			closeDownload(id)}>{X_SYMBOL}</C.DownloadInfo.X>
	</C.DownloadInfo.Container>;
};

const Download = ({ isOpen, closeModalCallback }: DownloadProps) => {
	const { pendingDownloads, clearPendingDownloads } = React.useContext(AppContext);
	const [downloads, setDownloads] = React.useState(new Map<string, DownloadObj>());

	const update = (id: string) => (status: DownloadProgress) =>
		setDownloads(down => {
			if (down.has(id)) {
				const u: Partial<DownloadInfoProps> = status !== null ? {
					down: Math.round(status.downBytes * 10e-3) * 10e-3,
					total: Math.round(status.totalBytes * 10e-3) * 10e-3,
					pct: Math.round(status.downBytes
						/ (status.totalBytes || 1) * 100),
				} : { status: "Stopped" };
				return new Map(down).set(id, { ...down.get(id), ...u });
			}
		});

	const closeDownload = async (id: string) => {
		const dl = downloads.get(id);
		if (!dl) return;

		const status = await promiseStatus(dl.download.promise);
		if (status === "pending") dl.download.abort();
		else setDownloads(down => {
			let m = new Map(down);
			m.delete(id);
			return m;
		});
	}

	React.useMemo(async () => {
		const pending = await clearPendingDownloads();
		if (!pending || pending.oldQueue.length === 0) return;

		setDownloads(new Map([...downloads, ...pending.oldQueue.reduce((map, v) => {
			const id = uniqueId("download-");
			return map.set(id, {
				id,
				url: v.url,
				path: v.path,
				down: 0,
				total: 0,
				pct: 0,
				download: downloadFile(v.url, v.path, update(id)),
				status: "Downloading",
			});
		}, new Map<string, DownloadObj>())]));
	}, [pendingDownloads]);

	const els = React.useMemo(() => Array.from(downloads.values()).map(v =>
		<DownloadInfo key={v.id} id={v.id} url={v.url} path={v.path} down={v.down}
			total={v.total} pct={v.pct} closeDownload={closeDownload}
			status={v.status} />), [downloads]);

	return <Modal isOpen={isOpen}
		onRequestClose={closeModalCallback}
		shouldCloseOnOverlayClick={false}
		shouldCloseOnEsc={false}
		style={{
			content: {
				background: '#17172d',
				color: '#fff',
			},
			overlay: {
				zIndex: 3
			}
		}}>
		<C.Download.Container>
			<h2>Downloads</h2>
			<C.Download.Body>{els.length !== 0 ?
				els : "No Downloads"}</C.Download.Body>
			<div>
				<div className="ok-cancel">
					<button onClick={closeModalCallback}>Close</button>
				</div>
			</div>
		</C.Download.Container>
	</Modal>
};

export default Download;