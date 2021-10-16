# FeatherDeX Desktop Trading Application

This desktop application allows you to trade on the Omnifeather decentralized exchange that runs on the Feathercoin blockchain. For more information on Omnifeather, visit https://omnifeather.com/ or its GitHub site https://github.com/OmniLayer/omnifeather.

## How to Use

Before starting this application, you must enable `-experimental-btc-balances=1` on the omnifeather client.

If you are running the daemon, use

```bash
omnifeatherd -experimental-btc-balances=1
```

If you are running the GUI, use

```bash
omnifeather-qt -experimental-btc-balances=1
```

Alternatively, in `feathercoin.conf`, add the line

```experimental-btc-balances=1```

## How to Build

Must have Node.js, preferably v14 LTS. Run:

```bash
git clone https://github.com/featherdex/featherdex.git
cd featherdex
```

```bash
npm i
npm run deliver
```

The built binaries should be in `./dist/[PLATFORM]/`.

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
