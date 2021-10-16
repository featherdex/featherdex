import React from 'react';
import Modal from 'react-modal';

import Icon from '../img/icon-256px.png';
import { VERSION_STRING } from './constants';
import './app.css';

type AboutProps = {
	isOpen: boolean,
	closeModalCallback: () => void,
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
			<div className="about-body">
				<div className="about-logo">
					<img src={Icon} alt="FeatherDeX logo" />
				</div>
				<div className="about-text">
					<p>
						FeatherDeX Trader<br />version {VERSION_STRING}
					</p>
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
					<p>
						Built with Node.js and node-webkit
					</p>
				</div>
			</div>
			<div className="ok-cancel">
				<button onClick={closeModalCallback}>Okay</button>
			</div>
		</Modal>
	</div>
		;
};