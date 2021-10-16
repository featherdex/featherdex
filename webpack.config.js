const path = require('path');

module.exports = {
	entry: ['./src/app.tsx'],
	output: {
		path: path.resolve(__dirname, 'build'),
		filename: 'app.bundle.js'
	},
	resolve: {
		extensions: ['.ts', '.tsx', '.js']
	},
	target: "node-webkit",
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
		'node-fetch': 'commonjs2 node-fetch',
	},
};