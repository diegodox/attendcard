{
  description = "AttendCard - Development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_20
            nodePackages.npm
            nodePackages.nodemon
            python3
            pkg-config
            sqlite
          ];

          shellHook = ''
            echo "AttendCard development environment"
            echo "Node.js version: $(node --version)"
            echo "npm version: $(npm --version)"
            echo ""
            echo "Available commands:"
            echo "  npm install    - Install dependencies"
            echo "  npm start      - Start the server"
            echo "  npm run dev    - Start development server with nodemon"
            echo ""
          '';
        };
      });
}