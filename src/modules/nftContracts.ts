import { Address, Bytes, log } from "@graphprotocol/graph-ts"
import { globalState } from "."
import { ERC721MetaData } from "../../generated/openseaWyvernExchange/ERC721MetaData"
import { NftContract } from "../../generated/schema"

export namespace nftContracts {
	export function loadNftContract(id: string): NftContract {
		let entity = NftContract.load(id)
		return entity as NftContract
	}
	export function getOrCreateNftContract(address: Bytes): NftContract {
		let id = `nft-${address.toHexString()}`
		let entity = NftContract.load(id)
		if (entity == null) {
			entity = new NftContract(id)
			entity.address = address
			globalState.helpers.updateGlobal_nfts_Counter()

			let erc721Contract = ERC721MetaData.bind(Address.fromString(address.toHexString()));

			let symbol = erc721Contract.try_symbol();
			let name = erc721Contract.try_name();

			if(!symbol.reverted) {
				entity.symbol = symbol.value;
			}

			if(!name.reverted) {
				entity.name = name.value;
			}

		}
		return entity as NftContract
	}
}