import Head from 'next/head';
import {NextPage} from "next";
import {ChangeEvent, useEffect, useRef, useState} from "react";
import {toast, ToastContainer} from 'react-toastify';
import {Window as KeplrWindow} from "@keplr-wallet/types";
import {SecretNetworkClient, ViewingKey} from "secretjs";
import {CSVLink} from "react-csv";
import {utils, writeFile} from "xlsx";
import {TransactionHistoryResponse, TransferHistoryResponse} from "secretjs/dist/extensions/snip20/types";
import "react-toastify/dist/ReactToastify.css";

declare global {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Window extends KeplrWindow {}
}

const Home: NextPage = () => {

    const [contractAddress, setContractAddress] = useState<string>("");
    const [senderAddress, setSenderAddress] = useState<string>("");
    const [receiverAddress, setReceiverAddress] = useState<string>("");
    const [minimumAmount, setMinimumAmount] = useState<number>(0);
    const [transactions, setTransactions] = useState<any>([]);
    const [tokenDecimals, setTokenDecimals] = useState<number>(0);
    const [filteredTransactions, setFilteredTransactions] = useState<any>([]);
    const [loading, setLoading] = useState<boolean>(false);

    const csvLink = useRef();

    const exportXLSX = () => {
        let sheet = utils.json_to_sheet(
            filteredTransactions.map((transaction: any) => ({
                sender: transaction.sender,
                receiver: transaction.reciever,
                amount: transaction.coins.amount / 10**tokenDecimals
            }))
        );
        let wb = utils.book_new();
        utils.book_append_sheet(wb, sheet, `Transaction History`)
        writeFile(wb, 'history.xlsx');
    }

    const exportCSV = () => {
        // @ts-ignore
        csvLink.current.link.click();
    }

    const connectKeplr = async () => {
        try {
            const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
            while (
                !window.keplr ||
                !window.getEnigmaUtils ||
                !window.getOfflineSignerOnlyAmino
                ) {
                await sleep(50);
            }
            await window.keplr.enable("secret-4");
            const keplrOfflineSigner = window.keplr.getOfflineSignerOnlyAmino("secret-4");
            const [{ address: myAddress }] = await keplrOfflineSigner.getAccounts();
            return await SecretNetworkClient.create({
                grpcWebUrl: 'https://secret-4.api.trivium.network:9091',
                chainId: 'secret-4',
                wallet: keplrOfflineSigner,
                walletAddress: myAddress,
                encryptionUtils: window.keplr.getEnigmaUtils('secret-4'),
            });
        } catch (e: any) {
            toast.error(e.message);
            console.error(e);
        }
        return null;
    }

    const fetchHistory = async () => {
        if(contractAddress.length < 16) {
            toast.error("Please enter a valid contract address.");
            return
        }
        setLoading(true);
        const client = await connectKeplr();
        if(client !== null && window.keplr) {
            let codeHash: string, viewingKey: ViewingKey;
            try {
                codeHash = await client.query.compute.contractCodeHash(contractAddress);
            } catch (e: any) {
                toast.error("Failed to fetch the contract code hash!");
                console.error(e);
                setLoading(false);
                return
            }
            try {
                viewingKey = await window.keplr.getSecret20ViewingKey("secret-4", contractAddress);
            } catch (e) {
                console.error(e);
                toast.info("Token not found, please follow the Keplr popup to add it.");
                try {
                    await window.keplr.suggestToken("secret-4", contractAddress);
                    toast.success("Token added successfully. Please try fetching again!");
                } catch (e: any) {
                    console.error();
                    toast.error(e.message);
                }
                setLoading(false);
                return
            }
            setFilteredTransactions([]);
            setTransactions([]);
            setTokenDecimals(0);
            const id = toast.loading("Fetching history...");
            try {
                let foundTransactions: any = [];
                let currentPage = 0;

                const tokenInfoResponse: any = await client.query.compute.queryContract({
                    contractAddress: contractAddress,
                    codeHash: codeHash,
                    query: {
                        token_info: {}
                    }
                });
                if(tokenInfoResponse.token_info && tokenInfoResponse.token_info.decimals) {
                    setTokenDecimals(tokenInfoResponse.token_info.decimals);
                } else {
                    setLoading(false);
                    console.log(tokenInfoResponse);
                    toast.update(
                        id,
                        {
                            render: "Failed to query `token_info` for this contract.",
                            autoClose: 5000,
                            type: "error",
                            isLoading: false
                        }
                    );
                    return
                }

                while(true) {
                    const transactionHistoryResponse: TransactionHistoryResponse = await client.query.snip20.getTransactionHistory({
                        contract: {
                            address: contractAddress,
                            codeHash: codeHash
                        },
                        address: client.address,
                        auth: {
                            key: viewingKey,
                        },
                        page: currentPage,
                        page_size: 1000
                    });
                    if(transactionHistoryResponse.transaction_history && transactionHistoryResponse.transaction_history.txs) {
                        if(transactionHistoryResponse.transaction_history.txs.length > 0) {
                            foundTransactions = [
                                ...foundTransactions,
                                ...transactionHistoryResponse.transaction_history.txs
                            ];
                            if(transactionHistoryResponse.transaction_history.txs.length === 1000) {
                                currentPage += 1;
                            } else {
                                break;
                            }
                        } else {
                            break;
                        }
                    } else {
                        const transferHistoryResponse: TransferHistoryResponse = await client.query.snip20.getTransferHistory({
                            contract: {
                                address: contractAddress,
                                codeHash: codeHash
                            },
                            address: client.address,
                            auth: {
                                key: viewingKey,
                            },
                            page: currentPage,
                            page_size: 1000
                        });
                        if(transferHistoryResponse.transfer_history && transferHistoryResponse.transfer_history.txs) {
                            if(transferHistoryResponse.transfer_history.txs.length > 0) {
                                foundTransactions = [
                                    ...foundTransactions,
                                    ...transferHistoryResponse.transfer_history.txs
                                ];
                                if(transferHistoryResponse.transfer_history.txs.length === 1000) {
                                    currentPage += 1;
                                } else {
                                    break;
                                }
                            } else {
                                break;
                            }
                        }
                    }
                }
                toast.update(
                    id,
                    {
                        render: `Found ${foundTransactions.length} transaction(s) in your history!`,
                        type: "success",
                        autoClose: 5000,
                        isLoading: false
                    }
                );
                setFilteredTransactions(foundTransactions);
                setTransactions(foundTransactions);
            } catch (e: any) {
                console.error(e);
                toast.update(
                    id,
                    {
                        render: e.message,
                        autoClose: 5000,
                        type: "error",
                        isLoading: false
                    }
                );
            }
        }
        setLoading(false);
    }

    useEffect(() => {
        setFilteredTransactions(transactions.filter((transaction: any) => {
            if(minimumAmount > 0 && tokenDecimals !== 0) {
                if(transaction.coins.amount < minimumAmount * 10**tokenDecimals) {
                    return false;
                }
            }
            if(receiverAddress) {
                if(transaction.receiver !== receiverAddress) {
                    return false;
                }
            }
            if(senderAddress) {
                if(transaction.sender !== senderAddress) {
                    return false;
                }
            }
            return true;
        }))
    }, [minimumAmount, receiverAddress, senderAddress]);

    return (
        <>
            <Head>
                <title>Snip-20 History</title>
                <meta name="description" content="Fetch transaction history for SNIP-20 tokens on Secret Network." />
            </Head>

            <main className="flex flex-col w-full items-center py-6">
                <h1 className="text-2xl sm:text-4xl text-white">
                  Snip-20 Transaction History
                </h1>
                <div className="mt-8 w-full flex flex-col items-center max-w-sm py-5 px-10 bg-gray-700 rounded-box">
                    <div className="form-control w-full max-w-md">
                        <label className="label">
                            <span className="label-text">Contract address</span>
                        </label>
                        <input type="text" placeholder="Enter an address..." value={contractAddress} disabled={loading}
                               className="input input-bordered w-full"
                               onChange={(e: ChangeEvent<HTMLInputElement>) => setContractAddress(e.target.value)}
                        />
                    </div>
                    <button
                        className="mt-4 btn btn-accent w-2/3 text" disabled={loading}
                        onClick={fetchHistory}
                    >
                        { loading ?
                            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                                 xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                                        strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor"
                                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            :
                            <span>Fetch History</span>
                        }
                    </button>
                </div>

                { tokenDecimals !== 0 && transactions && transactions.length > 0 && (
                    <div className="w-full sm:max-w-screen-lg flex flex-col mx-auto">
                        <div className="px-4 w-full mx-auto flex flex-col sm:flex-row gap-x-4 gap-y-1 my-2">
                            <div className="form-control w-full max-w-sm">
                                <label className="label">
                                    <span className="label-text">Sender</span>
                                </label>
                                <input type="text" placeholder="Enter an address..." value={senderAddress}
                                       className="input input-bordered w-full"
                                       onChange={(e: ChangeEvent<HTMLInputElement>) => setSenderAddress(e.target.value)}
                                />
                            </div>
                            <div className="form-control w-full max-w-sm">
                                <label className="label">
                                    <span className="label-text">Receiver</span>
                                </label>
                                <input type="text" placeholder="Enter an address..." value={receiverAddress}
                                       className="input input-bordered w-full"
                                       onChange={(e: ChangeEvent<HTMLInputElement>) => setReceiverAddress(e.target.value)}
                                />
                            </div>
                            <div className="form-control w-fit">
                                <label className="label">
                                    <span className="label-text">Minimum amount</span>
                                </label>
                                <input type="number" placeholder="Enter an amount..." value={minimumAmount}
                                       className="input input-bordered w-full"
                                       onChange={(e: ChangeEvent<HTMLInputElement>) => setMinimumAmount(Number(e.target.value))}
                                />
                            </div>
                        </div>
                        <div className="overflow-y-auto overflow-x-auto w-full border border-accent rounded-box h-72">
                            <table className="table table-compact table-zebra w-full h-full">
                                <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Amount</th>
                                    <th>Sender</th>
                                    <th>Receiver</th>
                                </tr>
                                </thead>
                                <tbody>
                                { filteredTransactions.map((transaction: any) => (
                                    <tr key={transaction.id}>
                                        <th>{transaction.id}</th>
                                        <td>{transaction.coins.amount / (10**tokenDecimals)}</td>
                                        <td>{transaction.sender}</td>
                                        <td>{transaction.receiver}</td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="w-full mt-2 flex justify-between px-10">
                            <button className="btn btn-accent w-fit text" onClick={exportXLSX}>
                                Export to XLSX
                            </button>
                            <button className="btn btn-accent w-fit text" onClick={exportCSV}>
                                Export to CSV
                            </button>
                        </div>
                    </div>

                )}
                <CSVLink
                    // @ts-ignore
                    ref={csvLink}
                    data={
                        filteredTransactions.map((transaction: any) => ({
                            id: transaction.id,
                            sender: transaction.sender,
                            receiver: transaction.receiver,
                            amount: transaction.coins.amount / 10**tokenDecimals
                        }))
                    }
                    filename='snapshot.csv'
                    className='hidden'
                    target='_blank'
                />
                <ToastContainer
                    position="top-right"
                    autoClose={5000}
                    theme="dark"
                />
          </main>
        </>
    )
}

export default Home;