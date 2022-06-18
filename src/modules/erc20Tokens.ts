import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
import { globalState } from "."
import { ERC20 } from "../../generated/openseaWyvernExchange/ERC20"
import { Erc20Transaction, Erc20Token } from "../../generated/schema"

export namespace erc20Tokens {
	export function getOrCreateToken(address: Bytes): Erc20Token {
		let id = `erc20-${address.toHexString()}`
		let entity = Erc20Token.load(id)
		if (entity == null) {
			entity = new Erc20Token(id)
			entity.address = address
			globalState.helpers.updateGlobal_erc20tokens_Counter()

			let erc20ContractInstance = ERC20.bind(Address.fromString(address.toHexString()));
			let decimals = erc20ContractInstance.try_decimals();
			entity.decimals = 18;
			if(!decimals.reverted) {
				entity.decimals = decimals.value;
			}
		}
		return entity as Erc20Token
	}
	export function getOrCreateErc20Transaction(
		timestamp: BigInt, tokenId: string, from: string, to: string,
		amount: BigInt, sale: string
	): Erc20Transaction {
		let id = timestamp.toString().concat("-").concat(tokenId)
		let entity = Erc20Transaction.load(id)
		if (entity == null) {
			entity = new Erc20Transaction(id)
			entity.timestamp = timestamp
			entity.from = from
			entity.to = to
			entity.contract = tokenId
			entity.amount = amount
			entity.sale = sale
			globalState.helpers.updateGlobal_erc20transactions_Counter()

		}
		return entity as Erc20Transaction
	}
}