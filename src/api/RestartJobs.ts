/*
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 *
 */

import { IJob, GetJobs, SubmitJobs, JOB_STATUS, ISpoolFile } from "@zowe/cli";
import {
    AbstractSession,
    ImperativeError,
    ImperativeExpect,
} from "@zowe/imperative";
import { IRestartParms } from "./doc/input/IRestartParms";

/**
 * Class of restart jobs APIs for usage within the CLI and programmatically from node scripts
 *
 * @export
 * @class RestartJobs
 */
export class RestartJobs {
    /**
     * Get JCL for job and modify it for a restart
     *
     * @static
     * @param {AbstractSession} session - z/OSMF connection info
     * @param {string} stepname - name of a step, which to restart from
     * @param {IJob} job - job to get JCL for
     * @throws {ImperativeError} - throws an error if specified step name is not found in JCL
     * @returns {Promise<string>} - promise that resolves to a string, which contains JCL modified for a restart
     * @memberof RestartJobs
     */
    public static async getRestartJclForJob(
        session: AbstractSession,
        stepname: string,
        job: IJob
    ): Promise<string> {
        const upperCasedStepName = stepname.toUpperCase();
        const jobJcl = await GetJobs.getJclForJob(session, job);

        // Check if specified step name really exists in JCL
        if (!new RegExp(`//${upperCasedStepName}\\s+EXEC`, "i").test(jobJcl)) {
            throw new ImperativeError({
                msg: `Step name ${upperCasedStepName} is not found in a job with jobid ${job.jobid}`,
            });
        }

        let isJobStatementFound = false;
        let isRestartParamAdded = false;
        return (
            jobJcl
                .split("\n")
                // Remove redundant jobid at the end of the JOB statement
                // And trim all the lines
                .map((rawLine) =>
                    (/JOB/i.test(rawLine)
                        ? rawLine.replace(job.jobid, "")
                        : rawLine
                    ).trim()
                )
                // Search where the RESTART= parameter can be added
                .map((clearedLine) => {
                    // Do not try to process comment lines
                    if (clearedLine.startsWith("//*")) return clearedLine;

                    // Signal that the JOB statement processing has started
                    if (/JOB/i.test(clearedLine)) isJobStatementFound = true;

                    // If the JOB statement is processed and the restart parameter was not added yet
                    if (isJobStatementFound && !isRestartParamAdded) {
                        // If already specified RESTART= parm is found -> replace it with new step name
                        // and stop searching
                        if (clearedLine.match(/RESTART=\(\S*\)/i)) {
                            isRestartParamAdded = true;
                            return clearedLine.replace(
                                /RESTART=\(\S*\)/i,
                                `RESTART=(${upperCasedStepName})`
                            );
                        }

                        // If no RESTART= parm is found inline and it is no continuation to next line ->
                        // add continuation and RESTART= parm on next line, then stop searching
                        if (!clearedLine.endsWith(",")) {
                            isRestartParamAdded = true;
                            return [
                                `${clearedLine},`,
                                `// RESTART=(${upperCasedStepName})`,
                            ].join("\n");
                        }
                    }
                    return clearedLine;
                })
                .join("\n")
        );
    }

    /**
     * Check if job is failed and return its JCL prepared for restart
     *
     * @static
     * @param {AbstractSession} session - z/OSMF connection info
     * @param {string} jobid - job id to be translated into parms object
     * @param {string} stepname - a name of a step, which to restart from
     * @throws {ImperativeError} - throws an error if job is in ACTIVE state and return code is not "CC 0000"
     * @returns {Promise<string>} - promise that resolves to a string, which contains JCL to be restarted
     * @memberof RestartJobs
     */
    public static async getFailedJobRestartJcl(
        session: AbstractSession,
        jobid: string,
        stepname: string
    ): Promise<string> {
        // Get the job details
        const job: IJob = await GetJobs.getJob(session, jobid);

        const errorMessagePrefix: string = `Restarting job with id ${jobid} on ${session.ISession.hostname}:${session.ISession.port} failed: `;

        ImperativeExpect.toBeEqual(
            job.status,
            JOB_STATUS.OUTPUT,
            errorMessagePrefix + "Job status is ACTIVE, OUTPUT is required"
        );
        ImperativeExpect.toNotBeEqual(
            job.retcode,
            "CC 0000",
            errorMessagePrefix + "Job status is successful, failed is required"
        );

        // Get the restart job JCL
        return this.getRestartJclForJob(session, stepname, job);
    }

    /**
     * Restart a job from a specific step
     *
     * @static
     * @param {AbstractSession} session - z/OSMF connection info
     * @param {string} jobid - job id to be translated into parms object
     * @param {string} stepname - name of a step, which to restart from
     * @throws {ImperativeError} - throws an error if job is in ACTIVE state and return code is not "CC 0000"
     * @returns {Promise<IJob>} - promise that resolves to an IJob document with details about the restarted job
     * @memberof RestartJobs
     */
    public static async restartFailedJob(
        session: AbstractSession,
        jobid: string,
        stepname: string
    ): Promise<IJob> {
        // Get the restart job JCL
        const restartJobJcl: string = await this.getFailedJobRestartJcl(
            session,
            jobid,
            stepname
        );

        // Re-submit restart job JCL
        return SubmitJobs.submitJcl(session, restartJobJcl);
    }

    /**
     * Restart a job from a specific step
     *
     * @static
     * @param {AbstractSession} session - z/OSMF connection info
     * @param {string} jobid - job id to be translated into parms object
     * @param {string} stepname - name of a step, which to restart from
     * @param {IRestartParms} parms - special object with restart parameters (see for details)
     * @throws {ImperativeError} - throws an error if job is in ACTIVE state and return code is not "CC 0000"
     * @returns {Promise<IJob | ISpoolFile[]>} - promise that resolves to an IJob document with details about the restarted job or
     * into a list of ISpoolFile documents with spool data set content
     * @memberof RestartJobs
     */
    public static async restartFailedJobWithParms(
        session: AbstractSession,
        jobid: string,
        stepname: string,
        parms: IRestartParms
    ): Promise<IJob | ISpoolFile[]> {
        // Get the restart job JCL
        const restartJobJcl: string = await this.getFailedJobRestartJcl(
            session,
            jobid,
            stepname
        );

        // Transform into ISubmitParms structure
        const submitParms = {
            jclSource: undefined as any,
            viewAllSpoolContent: parms.viewAllSpoolContent,
            directory: parms.directory,
            extension: parms.extension,
            waitForActive: parms.waitForActive,
            waitForOutput: parms.waitForOutput,
            task: parms.task,
        };

        // Re-submit restart job JCL
        return SubmitJobs.submitJclString(session, restartJobJcl, submitParms);
    }
}
