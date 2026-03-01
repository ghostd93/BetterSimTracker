const path = require("path");
const webpack = require("webpack");
const pkg = require("./package.json");

module.exports = {
  mode: "production",
  entry: "./src/index.ts",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "index.js",
    clean: true,
    library: {
      type: "module"
    }
  },
  experiments: {
    outputModule: true
  },
  externalsType: "module",
  externals: [
    function({ request }, callback) {
      if (typeof request === "string" && request.includes("../../..")) {
        return callback(null, `module ${request}`);
      }
      callback();
    },
  ],
  resolve: {
    extensions: [".ts", ".js"]
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
        exclude: /node_modules/
      }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      __BST_VERSION__: JSON.stringify(pkg.version),
    }),
  ]
};
