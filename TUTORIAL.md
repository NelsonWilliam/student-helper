## Preparando o Ubuntu

- Instale o Yarn

```
curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -
echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list
sudo apt-get update && sudo apt-get install yarn
```

- Instale o Node v8.x

```
curl -sL https://deb.nodesource.com/setup_8.x | sudo -E bash -
sudo apt-get update
sudo apt-get install -y nodejs
sudo apt-get install -y build-essential
sudo apt-get autoremove
```

- Instale o node-gyp

```
sudo npm install -g node-gyp
```

## Preparando o projeto

- Clone o repositório

```
git clone https://github.com/NelsonWilliam/student-helper/
```

- Instale as ferramentas

```
cd student-helper/Tools
npm install
```

## Fazendo uma build

- Vá para a pasta app do Electron

```
cd student-helper/ElectronClient/app
```

- Sincronize as bibliotecas

```
rsync --delete -a ../../ReactNativeClient/lib/ lib/
```

- Atualize as dependências (pode demorar vários minutos)

```
npm install
```

- Rode o Yarn (pode demorar vários minutos)

```
yarn dist
```

## Executando

- Vá para a pasta do Electron

```
cd student-helper/ElectronClient/
```

- Execute o script

```
./run.sh
```

- O programa será aberto.
