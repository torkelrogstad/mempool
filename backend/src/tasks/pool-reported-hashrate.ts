import axios, { AxiosResponse } from 'axios';
import PoolsRepository from '../repositories/PoolsRepository';
import logger from '../logger';
import HashratesRepository from '../repositories/HashratesRepository';
import config from '../config';

/**
 * Fetch reported hashrate from supported mining pools and save it into the database
 */
class PoolReportedHashrate {
  private running = false;
  private lastRun = 0;
  private apis = [
    { // Foundry USA
      pool_unique_id: 111,
      url: 'https://api.foundryusapool.com/pool_stats',
    },
    { // Antpool
      pool_unique_id: 44,
      url: 'https://www.antpool.com/auth/v3/index/poolcoins',
    },
    { // ViaBTC
      pool_unique_id: 73,
      url: 'https://www.viabtc.com/res/pool/BTC/state/usd/chart',
    },
    { // Binance
      pool_unique_id: 105,
      url: 'https://pool.binance.com/mining-api/v1/public/pool/index',
    },
    { // Luxor
      pool_unique_id: 4,
      url: 'https://luxor.tech/_next/data/meXMczO-GZZ-V3Xj2m2Kd/en/mining.json',
    }
  ];

  /**
   * Fetch mining pool reported hashrate every 1 hour
   */
  public async $run(): Promise<void> {
    if (config.MEMPOOL.NETWORK !== 'mainnet') {
      return;
    }

    if (this.running === true) {
      return;
    }

    // Only run once per 1 hour
    if ((Math.round(new Date().getTime() / 1000) - this.lastRun) < 3600) {
      return;
    }

    this.running = true;
    try {
      await this.$fetchReportedHashrate();
      this.lastRun = new Date().getTime() / 1000;
    } catch (e: any) {
      logger.err(`Cannot fetch reported hashrates. Reason: ${e instanceof Error ? e.message : e}`, logger.tags.mining);
    }

    this.running = false;
  }

  /**
   * Call all mining pool API and save the reported hashrate in the database
   */
  private async $fetchReportedHashrate(): Promise<void> {
    for (const api of this.apis) {
      try {
        const pool = await PoolsRepository.$getPoolByUniqueId(api.pool_unique_id);
        if (!pool) {
          logger.err(`Cannot fetch reported hashrate for pool with unique id ${api.pool_unique_id} because we cannot find it in our database, ignoring`, logger.tags.mining);
          continue;
        }
        logger.debug(`Querying reported hashrate for mining pool '${pool.name}' on url '${api.url}'`, logger.tags.mining);
        const response: AxiosResponse = await axios.get(api.url);
        if (response.statusText === 'error' || !response.data) {
          logger.err(`Unable to fetch reported hashrate from mining pool '${pool.name}'`, logger.tags.mining);
          continue;
        }
        
        const date = new Date();
        // date.setUTCMinutes(0);
        date.setUTCSeconds(0);
        date.setUTCMilliseconds(0);
        const dbEntry = {
          hashrateTimestamp: date.getTime() / 1000,
          poolId: api.pool_unique_id,
          share: -1, // Not used for 'reported' hashrate
          type: 'reported',
          avgHashrate: -1,
        };

        if (api.pool_unique_id === 111) { // Foundry USA
          dbEntry.avgHashrate = response.data.hashrate1hrAvg;
        } else if (api.pool_unique_id === 44) { // Antpool
          dbEntry.avgHashrate = parseFloat(response.data.data.items[0].poolHashrate.split(' ')[0]) * 1_000_000_000;
        } else if (api.pool_unique_id === 73) { // ViaBTC
          dbEntry.avgHashrate = Math.round(response.data.data.viabtc_hash[response.data.data.viabtc_hash.length - 1] / 1_000_000_000);
        } else if (api.pool_unique_id === 105) { // Binance
          dbEntry.avgHashrate = Math.round(parseFloat(response.data.data.algoList[0].poolHash) / 1_000_000_000);
        } else if (api.pool_unique_id === 4) { // Luxor
          dbEntry.avgHashrate = Math.round(parseFloat(response.data.pageProps.coinData.BTC.poolHashrate) / 1_000_000_000);
        }

        await HashratesRepository.$saveHashrate(dbEntry);
        logger.debug(`Successfully saved reported hashrate for mining pool '${pool.name}'`, logger.tags.mining);

      } catch (e) {
        logger.err(`Cannot fetch reported hashrate for pool with unique id ${api.pool_unique_id}. Reason: ${e}`);
      }
    }
  }
}

export default new PoolReportedHashrate;
