# FeatherDeX Desktop Trading Application

This desktop application allows you to trade on the Omnifeather decentralized exchange that runs on the Feathercoin blockchain. For more information on Omnifeather, visit https://omnifeather.com/ or its GitHub site https://github.com/OmniLayer/omnifeather.

You must have Omnifeather installed in order to use this application.

## How to Use

Before starting this application, make sure you open up your `feathercoin.conf` to add the below options. This file should be located at `C:\Users\[you]\AppData\Roaming\Feathercoin\feathercoin.conf` on Windows and `~/.feathercoin/feathercoin.conf` on Linux. If you are running the GUI, an easy way to find this file is by opening Omnifeather, then clicking Settings -> Options... -> Open Configuration File.

Make sure the config has the following options:

```
server=1
listen=1
daemon=1
rpcallowip=127.0.0.1
rpcport=8332
rpcuser=[YOUR USERNAME]
rpcpassword=[YOUR PASSWORD]
```

The `rpcuser` and `rpcpassword` must be set in order to run the app.

If your wallet is not in a standard location, you will have to open the settings in the app and select the Omnifeather conf file (`feathercoin.conf`).

Once you have started the client and it is up to date, you may start the application. To use any trade functionality, you must unlock the wallet! If you're getting errors about not being able to sign or send transactions, it's most likely that your wallet has been locked.

## How to Build

Must have Node.js, preferably v14 LTS. I prefer using `nvm`, the Node Version Manager. You can get it at https://github.com/nvm-sh/nvm. Please follow its instructions.

Then run:

```bash
git clone https://github.com/featherdex/featherdex.git
cd featherdex
npm i
```

For continuous test builds, run `npm run watch`. For production builds, run `npm run build`. Once you have built the app, run `npm run start`.

To package the app, run `npm run package`. The app should be in `./out/featherdex-[PLATFORM]-[ARCH]`.

To build deliverables for the app, run `npm run make`. The built deliverables should be in `./out/make/[FORMAT]/[PLATFORM]/[ARCH]/`.

## Bug Reports

If you have a GitHub account, please post bugs and other concerns in the 'Issues' tab of this repository. Otherwise, please message @cmt118 on the Feathercoin Telegram at https://t.me/FeathercoinOfficial. Thank you.

## Limited Liability Disclaimer

THIS SOFTWARE IS PROVIDED BY THE AUTHOR
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
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
