import { Address, BigDecimal, BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import { DailyNFTTransfer } from "../generated/schema";
import { abi, accounts, nftContracts, balances, nfts, sales, erc20Tokens, volumes, timeSeries, metadata } from "./modules";
import { getDayOpenTime, getDaysSinceEpoch } from "./modules/datetime";
import { getUsdPrice } from "./modules/prices";

export namespace mappingHelpers {

	// TODO document
	export function handleSingleSale(
		decoded: abi.Decoded_TransferFrom_Result,
		transactionId: string, contractAddress: Bytes,
		paymentTokenId: string, paymentTokenDecimal: i32, paymentAmount: BigInt,
		timestamp: BigInt, timeSeriesResult: timeSeries.HandleTimeSeriesResult,
		metadataResult: metadata.MetadataResult
	): void {
		let from = decoded.from
		let to = decoded.to
		let nftId = decoded.token
		let contract = nftContracts.getOrCreateNftContract(contractAddress)
		contract.save()
		// transfer

		let sale = sales.getOrCreateSale(timestamp.toString(), paymentTokenId)
		sale.block = metadataResult.blockId
		sale.transaction = metadataResult.txId
		sale.save()

		let buyer = accounts.getOrCreateAccount(to, transactionId)
		buyer.save()

		let seller = accounts.getOrCreateAccount(from, transactionId)
		seller.save()

		let erc20VolumesResult = volumes.handleErc20Volumes(
			contract.id, paymentAmount, timeSeriesResult
		)

		let nftVolumesResult = volumes.handleNftVolumes(
			contract.id, timeSeriesResult
		)

		let formattedAmount = paymentAmount.toBigDecimal().div(BigInt.fromI32(10).pow(paymentTokenDecimal as u8).toBigDecimal());

		handleNftTransfer(
			contract.address!, seller.id, buyer.id, nftId, timestamp, sale.id,
			nftVolumesResult, timeSeriesResult, metadataResult, paymentTokenId, formattedAmount)


		handleErc20Transfer(
			seller.id, buyer.id, paymentTokenId, paymentAmount, sale.id, 
			timestamp, erc20VolumesResult, timeSeriesResult, metadataResult
		)
	}

	export function handleBundleSale(
		decoded: abi.Decoded_atomicize_Result,
		transactionId: string, paymentTokenId: string, paymentTokenDecimal: i32,
		paymentAmount: BigInt, timestamp: BigInt,
		timeSeriesResult: timeSeries.HandleTimeSeriesResult,
		metadataResult: metadata.MetadataResult
	): void {

		let sale = sales.getOrCreateSale(timestamp.toString(), paymentTokenId)
		sale.block = metadataResult.blockId
		sale.transaction = metadataResult.txId
		sale.save()

		for (let i = 0; i < decoded.transfers.length; i++) {
			let from = decoded.transfers[i].from
			let to = decoded.transfers[i].to
			let nftId = decoded.transfers[i].token
			let contractAddress = decoded.addressList[i]

			let buyer = accounts.getOrCreateAccount(to, transactionId)
			buyer.save()

			let seller = accounts.getOrCreateAccount(from, transactionId)
			seller.save()

			let contract = nftContracts.getOrCreateNftContract(contractAddress)
			contract.save()

			let result = volumes.handleNftVolumes(contract.id, timeSeriesResult)


			let formattedAmount = paymentAmount.toBigDecimal().div(BigInt.fromI32(10).pow(paymentTokenDecimal as u8).toBigDecimal());

			handleNftTransfer(
				contractAddress, seller.id, buyer.id, nftId, timestamp, sale.id,
				result, timeSeriesResult, metadataResult, paymentTokenId,  formattedAmount);
			

		}
		let volumesResult = volumes.handleErc20Volumes(
			paymentTokenId, paymentAmount, timeSeriesResult
		)
		handleErc20Transfer(
			decoded.transfers[0].from.toHexString(), decoded.transfers[0].to.toHexString(),
			paymentTokenId, paymentAmount, sale.id, timestamp, volumesResult, timeSeriesResult,
			metadataResult
		)
	}

	function handleNftTransfer(
		contractAddress: Bytes, seller: string, buyer: string, nftId: BigInt,
		timestamp: BigInt, saleId: string, volumesResult: volumes.VolumesResult,
		timeSeriesResult: timeSeries.HandleTimeSeriesResult, metadataResult: metadata.MetadataResult,
		paymentTokenId: string, paymentAmount: BigDecimal

	): void {

		let contract = nftContracts.getOrCreateNftContract(contractAddress)
		contract.save()

		let nft = nfts.changeNftOwner(nftId, contract.id, buyer, contractAddress)
		nft.save()

		let nftTransaction = nfts.getOrCreateNftTransfer(
			nft.id, timestamp, seller, buyer, saleId
		)

		let erc20ContractAddress = paymentTokenId.split('-')[1];
		let usdValue  = getUsdPrice(Address.fromString(erc20ContractAddress), paymentAmount);
		
		let daySinceEpoch = getDaysSinceEpoch(timestamp.toI32());
		let dailyNFTTransactionId = contractAddress.toHexString() + "-"+ daySinceEpoch.toString();

		nftTransaction.block = metadataResult.blockId
		nftTransaction.transaction = metadataResult.txId
		nftTransaction.dailyNFTTransfer = dailyNFTTransactionId;
		nftTransaction.minuteVolume = volumesResult.minuteVolumeId
		nftTransaction.hourVolume = volumesResult.hourVolumeId
		nftTransaction.dayVolume = volumesResult.dayVolumeId
		nftTransaction.weekVolume = volumesResult.weekVolumeId
		nftTransaction.valueInUSD = usdValue;
		nftTransaction.amount = paymentAmount;

		nftTransaction.minute = timeSeriesResult.minute.id
		nftTransaction.hour = timeSeriesResult.hour.id
		nftTransaction.day = timeSeriesResult.day.id
		nftTransaction.week = timeSeriesResult.week.id
		nftTransaction.save()

		let dailyNFTTransaction = DailyNFTTransfer.load(dailyNFTTransactionId);

		if(dailyNFTTransaction == null) {
			dailyNFTTransaction = new DailyNFTTransfer(dailyNFTTransactionId);
			dailyNFTTransaction.count = BigInt.zero();
			dailyNFTTransaction.nft = contract.id;
			dailyNFTTransaction.daySinceEpoch = daySinceEpoch;
			dailyNFTTransaction.startDayTimestamp = getDayOpenTime(timestamp);
			dailyNFTTransaction.volumeInUSD = BigDecimal.zero();
		}
		dailyNFTTransaction.count = dailyNFTTransaction.count.plus(BigInt.fromI32(1));
		dailyNFTTransaction.orderCount = daySinceEpoch.toString()+"_"+dailyNFTTransaction.count.toString();
		dailyNFTTransaction.volumeInUSD = dailyNFTTransaction.volumeInUSD.plus(usdValue);
		dailyNFTTransaction.orderUSDVolume = daySinceEpoch.toString()+"_"+dailyNFTTransaction.volumeInUSD.toString();
		dailyNFTTransaction.save();
	}

	function handleErc20Transfer(
		buyerId: string, sellerId: string, paymentTokenId: string, paymentAmount: BigInt,
		saleId: string, timestamp: BigInt, volumesResult: volumes.VolumesResult,
		timeSeriesResult: timeSeries.HandleTimeSeriesResult, metadataResult: metadata.MetadataResult
	): void {

		let sellerBalance = balances.increaseBalanceAmount(
			sellerId,
			paymentTokenId,
			paymentAmount
		)
		sellerBalance.save()


		let buyerBalance = balances.decreaseBalanceAmount(
			buyerId,
			paymentTokenId,
			paymentAmount
		)
		buyerBalance.save()

		let erc20Transaction = erc20Tokens.getOrCreateErc20Transaction(
			timestamp, paymentTokenId, buyerId, sellerId, paymentAmount, saleId
		)
		erc20Transaction.increasedBalance = sellerBalance.id
		erc20Transaction.decreasedBalance = buyerBalance.id

		erc20Transaction.block = metadataResult.blockId
		erc20Transaction.transaction = metadataResult.txId

		erc20Transaction.minuteVolume = volumesResult.minuteVolumeId
		erc20Transaction.hourVolume = volumesResult.hourVolumeId
		erc20Transaction.dayVolume = volumesResult.dayVolumeId
		erc20Transaction.weekVolume = volumesResult.weekVolumeId

		erc20Transaction.minute = timeSeriesResult.minute.id
		erc20Transaction.hour = timeSeriesResult.hour.id
		erc20Transaction.day = timeSeriesResult.day.id
		erc20Transaction.week = timeSeriesResult.week.id
		erc20Transaction.save()
	}


}
