const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = [{ // Electron entry
	entry: './src/index.ts',
	output: {
		path: path.resolve(__dirname, 'build'),
		filename: 'index.js'
	},
	resolve: {
		extensions: ['.ts', '.tsx', '.js']
	},
	target: 'electron-main',
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				use: 'ts-loader'
			},
		]
	}
},
{ // React entry
	entry: ['./src/app.tsx'],
	output: {
		path: path.resolve(__dirname, 'build'),
		filename: 'app.bundle.js'
	},
	resolve: {
		extensions: ['.ts', '.tsx', '.js']
	},
	target: 'electron-renderer',
	devtool: 'eval-source-map',
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				exclude: /node_modules/,
				use: 'ts-loader'
			},
			{
				test: /\.(css)$/,
				sideEffects: true,
				use: ['style-loader', 'css-loader']
			},
			{
				test: /\.(png|jpg)$/,
				use: ['url-loader']
			}
		]
	},
	externals: {
		'dtrace-provider': 'commonjs2 dtrace-provider',
		'node-fetch': 'commonjs2 node-fetch',
		'better-sqlite3': 'commonjs better-sqlite3',
	},
	plugins: [new HtmlWebpackPlugin({
		template: 'src/index.html',
	})],
}];