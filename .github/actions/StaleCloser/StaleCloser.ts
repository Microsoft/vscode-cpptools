/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GitHub } from '../api/api'
import { ActionBase } from '../common/ActionBase'
import { daysAgoToHumanReadbleDate, daysAgoToTimestamp } from '../common/utils'

export class StaleCloser extends ActionBase {
	constructor(
		private github: GitHub,
		private closeDays: number,
		labels: string,
		private closeComment: string,
		private pingDays: number,
		private pingComment: string,
		private additionalTeam: string[],
		private addLabels?: string,
		milestoneName?: string,
		milestoneId?: string,
		ignoreLabels?: string,
		ignoreMilestoneNames?: string,
		ignoreMilestoneIds?: string,
		minimumVotes?: number,
		maximumVotes?: number
	)
	{
		super(labels, milestoneName, milestoneId, ignoreLabels, ignoreMilestoneNames, ignoreMilestoneIds, minimumVotes, maximumVotes);
	}

	async run() {
		const updatedTimestamp = daysAgoToHumanReadbleDate(this.closeDays)
		const pingTimestamp = this.pingDays ? daysAgoToTimestamp(this.pingDays) : undefined;

		const query = this.buildQuery((this.closeDays ? `updated:<${updatedTimestamp} ` : "") + "is:open is:unlocked");

		const addLabelsSet = this.addLabels ? this.addLabels.split(',') : [];

		for await (const page of this.github.query({ q: query })) {
			for (const issue of page) {
				const hydrated = await issue.getIssue()
				const lastCommentIterator = await issue.getComments(true).next()
				if (lastCommentIterator.done) {
					throw Error('Unexpected comment data')
				}
				const lastComment = lastCommentIterator.value[0]

				if (hydrated.open && this.validateIssue(hydrated)
					// TODO: Verify updated timestamp
				) {
					if (
						!lastComment ||
						lastComment.author.isGitHubApp ||
						// TODO: List the collaborators once per go rather than checking a single user each issue
						(pingTimestamp != undefined &&
							(this.additionalTeam.includes(lastComment.author.name) ||
							(await issue.hasWriteAccess(lastComment.author))))
					) {
						if (lastComment) {
							console.log(
								`Last comment on ${hydrated.number} by ${lastComment.author.name}. Closing.`,
							)
						} else {
							console.log(`No comments on ${hydrated.number}. Closing.`)
						}
						if (this.closeComment) {
							await issue.postComment(this.closeComment)
						}
						if (addLabelsSet.length > 0) {
							for (const addLabel of addLabelsSet) {
								if (addLabel && addLabel.length > 0) {
									console.log(`Adding label on ${hydrated.number}: ${addLabel}`)
									await issue.addLabel(addLabel)
								}
							}
						}
						console.log(`Closing ${hydrated.number}.`)
						await issue.closeIssue()
					} else if (pingTimestamp != undefined) {
						// Ping 
						if (hydrated.updatedAt < pingTimestamp && hydrated.assignee) {
							console.log(
								`Last comment on ${hydrated.number} by ${lastComment.author.name}. Pinging @${hydrated.assignee}`,
							)
							if (this.pingComment) {
								await issue.postComment(
									this.pingComment
										.replace('${assignee}', hydrated.assignee)
										.replace('${author}', hydrated.author.name),
								)
							}
						} else {
							console.log(
								`Last comment on ${hydrated.number} by ${lastComment.author.name}. Skipping.${
									hydrated.assignee ? ' cc @' + hydrated.assignee : ''
								}`,
							)
						}
					}
				} else {
					console.log(
						'Query returned an invalid issue:' +
							JSON.stringify({ ...hydrated, body: 'stripped' }),
					)
				}
			}
		}
	}
}
