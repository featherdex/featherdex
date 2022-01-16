import React from 'react';
import Modal from 'react-modal';
import styled from 'styled-components';

import Icon from '../img/icon-256px.png';
import { VERSION_STRING } from './constants';
import './app.css';

type AboutProps = {
	isOpen: boolean,
	closeModalCallback: () => void,
};


const C = {
	AboutBody: styled.div`
	height: calc(100% - 32px - 2*19.92px - 35px - 2*6px);
	overflow: auto;
	display: flex;`,
	AboutLogo: styled.div`
	margin: 16px 64px 0 64px;
	flex: 0.3;
	& > img {
		width: 100%;
	}`,
	AboutText: styled.div`
	padding-right: 32px;
	flex: 0.7;`,
};

export default function About({ isOpen, closeModalCallback }: AboutProps) {
	return <div>
		<Modal
			isOpen={isOpen}
			onRequestClose={closeModalCallback}
			shouldCloseOnOverlayClick={true}
			shouldCloseOnEsc={true}
			contentLabel="About"
			style={{
				content: {
					background: '#17172d',
					color: '#fff',
				},
				overlay: {
					zIndex: 2
				}
			}}
		>
			<h2>About</h2>
			<C.AboutBody>
				<C.AboutLogo><img src={Icon} alt="FeatherDeX logo" /></C.AboutLogo>
				<C.AboutText>
					<p>FeatherDeX Trader<br />version {VERSION_STRING}</p>
					<p>
						THIS SOFTWARE IS PROVIDED BY THE AUTHOR
						&quot;AS IS&quot; AND ANY EXPRESS OR IMPLIED WARRANTIES,
						INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
						MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
						DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
						ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
						CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
						PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF
						USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
						CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
						CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
						NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE
						USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY
						OF SUCH DAMAGE.
					</p>
					<p>Built with Node.js and Electron</p>
				</C.AboutText>
			</C.AboutBody>
			<div className="ok-cancel">
				<button onClick={closeModalCallback}>Okay</button>
			</div>
		</Modal>
	</div>
		;
};